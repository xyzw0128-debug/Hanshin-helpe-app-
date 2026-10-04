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

const SSO_CLIENT_ID = '5f0869ab6c0f4178874754fbd6c5bf64';
const SSO_BASE = 'https://sso2.hs.ac.kr';
const LMS_BASE = 'https://lms.hs.ac.kr';
const USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

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
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
}

function cleanText(s) {
  if (!s) return '';
  return s.replace(/\xa0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function run() {
  const ipResp = await fetch(`${SSO_BASE}/`, { headers: { 'User-Agent': USER_AGENT } });
  saveCookies(ipResp.headers);
  const ipHtml = await ipResp.text();
  const mIp = ipHtml.match(/id="loginIp"\s+value="([^"]*)"/);
  const clientIp = mIp ? mIp[1] : '';

  const authResp = await fetch(`${SSO_BASE}/oauth2/authoriza.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Cookie: getCookieHeader(),
    },
    body: new URLSearchParams({
      response_type: 'code',
      client_id: SSO_CLIENT_ID,
      state: '123456789',
      scope: 'http://sso.hs.ac.kr',
      redirect_uri: 'https://sso.hs.ac.kr/sso/loginSuccess.jsp',
      user_id: USER_ID,
      user_pwd: USER_PW,
      client_ip: clientIp,
    }).toString(),
  });
  saveCookies(authResp.headers);
  const authData = await authResp.json();
  if (authData.error !== '0000') throw new Error('Login failed');

  const tokenResp = await fetch(`${SSO_BASE}/oauth2/token2.do`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
      Cookie: getCookieHeader(),
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SSO_CLIENT_ID,
      code: authData.code,
      scope: 'http://sso.hs.ac.kr',
      client_ip: clientIp,
      redirect_uri: `${LMS_BASE}/main/MainView.dunet`,
    }).toString(),
  });
  saveCookies(tokenResp.headers);
  const tokenHtml = await tokenResp.text();
  const accessToken = tokenHtml.match(/name="access_token"\s+value="([^"]+)"/)[1];

  const lmsResp = await fetch(`${LMS_BASE}/main/MainView.dunet`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Cookie: getCookieHeader() },
    body: new URLSearchParams({ access_token: accessToken }).toString(),
    redirect: 'manual',
  });
  saveCookies(lmsResp.headers);

  const courseResp = await fetch(`${LMS_BASE}/lms/myLecture/doListView.dunet?mnid=201008840728`, {
    headers: { 'User-Agent': USER_AGENT, Cookie: getCookieHeader() },
  });
  saveCookies(courseResp.headers);
  const courseHtml = await courseResp.text();

  const courses = [];
  const regex = /myCourseList\.push\((\{.*?\})\);/gs;
  let match;
  while ((match = regex.exec(courseHtml)) !== null) {
    try {
      courses.push(JSON.parse(match[1].replace(/,\s*\}/g, '}')));
    } catch {}
  }

  console.log(`=== 수강 과목 전체 조회 (${courses.length}개) ===`);
  for (const c of courses) {
    const classResp = await fetch(`${LMS_BASE}/lms/class/classroom/doViewClassRoom.dunet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Cookie: getCookieHeader() },
      body: new URLSearchParams({
        mnid: '201008254671',
        course_id: c.course_id,
        class_no: c.class_no,
        change_role_no: '',
      }).toString(),
    });
    saveCookies(classResp.headers);
    const html = await classResp.text();

    const hasLenAct = html.includes('lenact_list');
    const hasStdAct = html.includes('std_act_box');
    console.log(`- [${c.course_nm}] 활동 항목: ${hasLenAct ? '있음' : '없음'}, 공지/자료: ${hasStdAct ? '있음' : '없음'}`);
  }
}

run().catch(console.error);
