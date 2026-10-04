import fs from 'fs';

let env = {};
try {
  if (fs.existsSync('.env')) {
    const envContent = fs.readFileSync('.env', 'utf-8');
    envContent.split('\n').forEach(line => {
      const [k, ...v] = line.split('=');
      if (k && v.length) env[k.trim()] = v.join('=').trim();
    });
  }
} catch (e) {}

const USER_ID = env.HS_USER_ID || process.env.HS_USER_ID;
const USER_PW = env.HS_USER_PW || process.env.HS_USER_PW;

console.log('Testing with User ID:', USER_ID);

const SSO_CLIENT_ID = '5f0869ab6c0f4178874754fbd6c5bf64';
const SSO_BASE = 'https://sso2.hs.ac.kr';
const LMS_BASE = 'https://lms.hs.ac.kr';
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

let cookies = {};

function saveCookies(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie') || ''];
  raw.forEach(header => {
    if (!header) return;
    header.split(';').forEach(part => {
      const trimmed = part.trim();
      if (trimmed.includes('=')) {
        const [k, v] = trimmed.split('=');
        if (k && !['path', 'domain', 'expires', 'samesite', 'httponly', 'secure'].includes(k.toLowerCase())) {
          cookies[k] = v;
        }
      }
    });
  });
}

function getCookieHeader() {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

async function runTest() {
  console.log('--- Step 0: Get Login IP ---');
  const ipResp = await fetch(`${SSO_BASE}/`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  saveCookies(ipResp.headers);
  const ipHtml = await ipResp.text();
  const mIp = ipHtml.match(/id="loginIp"\s+value="([^"]*)"/);
  const clientIp = mIp ? mIp[1] : '';
  console.log('Detected Client IP:', clientIp);

  console.log('--- Step 1: SSO Authorize ---');
  const authParams = new URLSearchParams({
    response_type: 'code',
    client_id: SSO_CLIENT_ID,
    state: '123456789',
    scope: 'http://sso.hs.ac.kr',
    redirect_uri: 'https://sso.hs.ac.kr/sso/loginSuccess.jsp',
    user_id: USER_ID,
    user_pwd: USER_PW,
    client_ip: clientIp,
  });

  const authResp = await fetch(`${SSO_BASE}/oauth2/authoriza.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Origin: SSO_BASE,
      Referer: `${SSO_BASE}/`,
      Cookie: getCookieHeader(),
    },
    body: authParams.toString(),
  });
  saveCookies(authResp.headers);
  const authData = await authResp.json();
  console.log('Auth response:', authData);

  if (authData.error !== '0000') {
    throw new Error('SSO 1단계 인증 실패: ' + JSON.stringify(authData));
  }
  const code = authData.code;
  console.log('Received auth code:', code);

  console.log('--- Step 2: SSO Token2 ---');
  const tokenParams = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: SSO_CLIENT_ID,
    code: code,
    scope: 'http://sso.hs.ac.kr',
    client_ip: clientIp,
    redirect_uri: `${LMS_BASE}/main/MainView.dunet`,
  });

  const tokenResp = await fetch(`${SSO_BASE}/oauth2/token2.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Origin: SSO_BASE,
      Referer: `${SSO_BASE}/`,
      Cookie: getCookieHeader(),
    },
    body: tokenParams.toString(),
  });
  saveCookies(tokenResp.headers);
  const tokenHtml = await tokenResp.text();
  const tokenMatch = tokenHtml.match(/name="access_token"\s+value="([^"]+)"/);
  if (!tokenMatch) {
    throw new Error('Access token not found in token2.do response');
  }
  const accessToken = tokenMatch[1];
  console.log('Received access token:', accessToken.slice(0, 15) + '...');

  console.log('--- Step 3: MainView.dunet (Set LMS Session) ---');
  const lmsSessionResp = await fetch(`${LMS_BASE}/main/MainView.dunet`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Cookie: getCookieHeader(),
    },
    body: new URLSearchParams({ access_token: accessToken }).toString(),
    redirect: 'manual',
  });
  saveCookies(lmsSessionResp.headers);
  console.log('LMS session response status:', lmsSessionResp.status);
  console.log('Current Cookies:', Object.keys(cookies));

  console.log('--- Step 4: Fetch Course List (doListView.dunet) ---');
  const courseResp = await fetch(`${LMS_BASE}/lms/myLecture/doListView.dunet?mnid=201008840728`, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: `${LMS_BASE}/main/MainView.dunet`,
      Cookie: getCookieHeader(),
    },
  });
  saveCookies(courseResp.headers);
  const courseHtml = await courseResp.text();

  const courses = [];
  const regex = /myCourseList\.push\((\{.*?\})\);/gs;
  let match;
  while ((match = regex.exec(courseHtml)) !== null) {
    try {
      const cleaned = match[1].replace(/,\s*\}/g, '}');
      const c = JSON.parse(cleaned);
      courses.push(c);
    } catch (e) {
      console.warn('Parse course error', e);
    }
  }

  console.log(`Found ${courses.length} courses:`);
  courses.forEach(c => console.log(` - [${c.course_id}_${c.class_no}] ${c.course_nm} (${c.prof_nm})`));

  console.log('--- Step 5: Test Classroom Detail Scraping ---');
  if (courses.length > 0) {
    const testCourse = courses[0];
    const classResp = await fetch(`${LMS_BASE}/lms/class/classroom/doViewClassRoom.dunet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Origin: LMS_BASE,
        Referer: `${LMS_BASE}/lms/myLecture/doListView.dunet?mnid=201008840728`,
        Cookie: getCookieHeader(),
      },
      body: new URLSearchParams({
        mnid: '201008254671',
        course_id: testCourse.course_id,
        class_no: testCourse.class_no,
        change_role_no: '',
      }).toString(),
    });
    saveCookies(classResp.headers);
    const classHtml = await classResp.text();
    console.log(`Classroom HTML fetched for ${testCourse.course_nm}, size: ${classHtml.length} bytes`);
    const hasLenAct = classHtml.includes('lenact_list');
    console.log(`Has lenact_list: ${hasLenAct}`);
  }

  console.log('=== TEST COMPLETED SUCCESSFULLY! ===');
}

runTest().catch(err => {
  console.error('Test failed with error:', err);
  process.exit(1);
});
