import { HttpClient } from './httpClient';
import { HSCTIS_BASE, USER_AGENT, HsctisAuthService } from './hsctisAuth';

export const RS = '\x1e'; // Record Separator (0x1E)
export const US = '\x1f'; // Unit Separator (0x1F)

export interface NexacroDataset {
  id: string;
  columns?: string[];
  rows: Array<Record<string, any>>;
}

export interface SsvPayloadOptions {
  variables?: Record<string, any>;
  datasets?: NexacroDataset[];
}

export interface NexacroResult {
  parameters: Record<string, string>;
  datasets: Record<string, Array<Record<string, string>>>;
  errorCode: string;
  errorMsg: string;
}

/**
 * 넥사크로 17 통신용 SSV (Stream Separator Value) 요청 페이로드 빌더
 */
export function buildSsvPayload(options: SsvPayloadOptions = {}): string {
  let payload = `SSV:utf-8${RS}`;

  const vars = { ...options.variables };
  const accessToken = vars.access_token || HsctisAuthService.getAccessToken();
  delete vars.access_token;

  // HAR 포맷 일치: access_token이 존재하면 SSV 헤더 직후 첫 번째 변수로 직렬화
  if (accessToken) {
    payload += `access_token=${accessToken}${RS}`;
  }

  // 1. 변수/파라미터 정의 (key=value\x1e)
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      payload += `${key}=${value !== undefined && value !== null ? value : ''}${RS}`;
    }
  }

  // 2. 데이터셋 정의 (Dataset:id\x1e_RowType_\x1fCol1:String(256)...)
  if (options.datasets) {
    for (const ds of options.datasets) {
      payload += `Dataset:${ds.id}${RS}`;

      const columns =
        ds.columns && ds.columns.length > 0
          ? ds.columns
          : ds.rows.length > 0
          ? Object.keys(ds.rows[0])
          : [];

      if (columns.length > 0) {
        const colDef = ['_RowType_', ...columns.map(c => `${c}:String(256)`)].join(US);
        payload += `${colDef}${RS}`;

        for (const row of ds.rows) {
          const rowVals = [
            'N',
            ...columns.map(c => {
              const val = row[c];
              return val !== undefined && val !== null ? String(val) : '';
            }),
          ].join(US);
          payload += `${rowVals}${RS}`;
        }
      }
    }
  }

  return payload;
}

export function unescapeXml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * 넥사크로 XML Dataset 및 SSV 응답 파서
 */
export function parseDatasets(raw: string): NexacroResult {
  const result: NexacroResult = {
    parameters: {},
    datasets: {},
    errorCode: '0',
    errorMsg: '',
  };

  if (!raw || typeof raw !== 'string') {
    return result;
  }

  const trimmed = raw.trim();

  // SSV 포맷 응답 감지 (SSV:utf-8 로 시작하거나 \x1e 포함)
  if (trimmed.startsWith('SSV:') || (raw.includes(RS) && !trimmed.startsWith('<'))) {
    return parseSsvResponse(raw);
  }

  // XML 포맷 파싱
  return parseXmlResponse(raw);
}

function parseXmlResponse(xml: string): NexacroResult {
  const result: NexacroResult = {
    parameters: {},
    datasets: {},
    errorCode: '0',
    errorMsg: '',
  };

  // 브라우저 DOMParser 지원 여부 확인
  if (typeof DOMParser !== 'undefined') {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');

      // 파서 에러 태그 확인
      if (!doc.querySelector('parsererror')) {
        // 파라미터 파싱
        const paramNodes = doc.querySelectorAll('Parameters > Parameter, Parameter');
        paramNodes.forEach(param => {
          const id = param.getAttribute('id') || param.getAttribute('name');
          if (id) {
            result.parameters[id] = unescapeXml(param.textContent || param.getAttribute('value') || '');
          }
        });

        // 데이터셋 파싱
        const datasetNodes = doc.querySelectorAll('Dataset');
        datasetNodes.forEach(dsNode => {
          const dsId = dsNode.getAttribute('id') || 'ds_default';
          const rows: Array<Record<string, string>> = [];

          const rowNodes = dsNode.querySelectorAll('Rows > Row, Row');
          rowNodes.forEach(rowNode => {
            const rowObj: Record<string, string> = {};
            const colNodes = rowNode.querySelectorAll('Col');
            colNodes.forEach(col => {
              const colId = col.getAttribute('id') || col.getAttribute('name');
              if (colId) {
                rowObj[colId] = unescapeXml(col.textContent || col.getAttribute('value') || '');
              }
            });
            rows.push(rowObj);
          });

          result.datasets[dsId] = rows;
        });

        result.errorCode = result.parameters['ErrorCode'] || '0';
        result.errorMsg = result.parameters['ErrorMsg'] || '';
        return result;
      }
    } catch (e) {
      console.warn('DOMParser failed, falling back to regex parser', e);
    }
  }

  // 정규식 기반 XML 파서 (Node.js 환경 또는 파서 실패 시 Fallback)
  // <Parameter id="x">val</Parameter> 및 <Parameter id="x" value="val"/> 지원
  const paramRegex = /<Parameter\b([^>]*?)(?:\/>|>(.*?)<\/Parameter>)/gs;
  let pMatch: RegExpExecArray | null;
  while ((pMatch = paramRegex.exec(xml)) !== null) {
    const attrs = pMatch[1];
    const body = pMatch[2];
    const idMatch = attrs.match(/\b(?:id|name)=["']([^"']+)["']/i);
    if (!idMatch) continue;
    const id = idMatch[1];
    let val = '';
    const valAttrMatch = attrs.match(/\bvalue=["']([^"']*)["']/i);
    if (valAttrMatch) {
      val = unescapeXml(valAttrMatch[1]);
    } else if (body !== undefined) {
      val = unescapeXml(body.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim());
    }
    result.parameters[id] = val;
  }

  const datasetRegex = /<Dataset[^>]*id=["']([^"']+)["'][^>]*>(.*?)<\/Dataset>/gs;
  let dsMatch: RegExpExecArray | null;
  while ((dsMatch = datasetRegex.exec(xml)) !== null) {
    const dsId = dsMatch[1];
    const dsContent = dsMatch[2];
    const rows: Array<Record<string, string>> = [];

    const rowRegex = /<Row[^>]*>(.*?)<\/Row>/gs;
    let rMatch: RegExpExecArray | null;
    while ((rMatch = rowRegex.exec(dsContent)) !== null) {
      const rowContent = rMatch[1];
      const rowObj: Record<string, string> = {};

      // <Col id="x">val</Col> 및 <Col id="x" value="val"/> 지원
      const colRegex = /<Col\b([^>]*?)(?:\/>|>(.*?)<\/Col>)/gs;
      let cMatch: RegExpExecArray | null;
      while ((cMatch = colRegex.exec(rowContent)) !== null) {
        const cAttrs = cMatch[1];
        const cBody = cMatch[2];
        const idMatch = cAttrs.match(/\b(?:id|name)=["']([^"']+)["']/i);
        if (!idMatch) continue;
        const colId = idMatch[1];
        let colVal = '';
        const valAttrMatch = cAttrs.match(/\bvalue=["']([^"']*)["']/i);
        if (valAttrMatch) {
          colVal = unescapeXml(valAttrMatch[1]);
        } else if (cBody !== undefined) {
          colVal = unescapeXml(cBody.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').trim());
        }
        rowObj[colId] = colVal;
      }

      rows.push(rowObj);
    }

    result.datasets[dsId] = rows;
  }

  result.errorCode = result.parameters['ErrorCode'] || '0';
  result.errorMsg = result.parameters['ErrorMsg'] || '';
  return result;
}

function parseSsvResponse(ssv: string): NexacroResult {
  const result: NexacroResult = {
    parameters: {},
    datasets: {},
    errorCode: '0',
    errorMsg: '',
  };

  const records = ssv.split(RS);
  let currentDsId: string | null = null;
  let currentColumns: string[] = [];

  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed || trimmed.startsWith('SSV:')) continue;

    // 1. Dataset 시작
    if (trimmed.startsWith('Dataset:')) {
      currentDsId = trimmed.replace('Dataset:', '').trim();
      result.datasets[currentDsId] = [];
      currentColumns = [];
      continue;
    }

    // 2. 컬럼 메타데이터 정의
    if (trimmed.startsWith('_RowType_')) {
      const parts = trimmed.split(US);
      currentColumns = parts.slice(1).map(colDef => {
        const colonIdx = colDef.indexOf(':');
        return colonIdx > 0 ? colDef.substring(0, colonIdx) : colDef;
      });
      continue;
    }

    // 3. 파라미터 / 변수 (key=value) 감지
    // 데이터 행이 아니고 (N, I, U, D로 시작하지 않거나 '='를 포함하며 US가 없거나 파라미터 형태인 경우)
    const isRowTypePrefix = /^[NIUD](\x1f|$)/.test(record);
    if (!isRowTypePrefix && trimmed.includes('=')) {
      // 데이터셋 컨텍스트 종료
      currentDsId = null;
      currentColumns = [];

      const eqIdx = trimmed.indexOf('=');
      const k = trimmed.substring(0, eqIdx).trim();
      const v = trimmed.substring(eqIdx + 1).trim();
      result.parameters[k] = v;
      continue;
    }

    // 4. 데이터셋 데이터 행 파싱
    if (currentDsId && currentColumns.length > 0) {
      const parts = record.split(US);
      // parts[0] is row type ('N', 'I', 'U', 'D')
      const rowVals = parts.slice(1);
      const rowObj: Record<string, string> = {};
      for (let i = 0; i < currentColumns.length; i++) {
        rowObj[currentColumns[i]] = rowVals[i] !== undefined ? rowVals[i] : '';
      }
      result.datasets[currentDsId].push(rowObj);
      continue;
    }

    // 5. 기타 파라미터
    if (trimmed.includes('=')) {
      const eqIdx = trimmed.indexOf('=');
      const k = trimmed.substring(0, eqIdx).trim();
      const v = trimmed.substring(eqIdx + 1).trim();
      result.parameters[k] = v;
    }
  }

  result.errorCode = result.parameters['ErrorCode'] || '0';
  result.errorMsg = result.parameters['ErrorMsg'] || '';
  return result;
}

export class NexacroClient {
  public static async postService(
    serviceName: string,
    options: SsvPayloadOptions = {}
  ): Promise<NexacroResult> {
    let url: string;
    if (serviceName.startsWith('http')) {
      url = serviceName;
    } else if (serviceName.startsWith('/')) {
      url = `${HSCTIS_BASE}${serviceName}`;
    } else {
      // 한신대 hsctis 모듈별 URL 매핑 (예: um72_0272005 -> /um/um72_0272005)
      const modulePrefix = serviceName.includes('_') ? serviceName.split('_')[0].slice(0, 2) : 'um';
      url = `${HSCTIS_BASE}/${modulePrefix}/${serviceName}`;
    }

    const payload = buildSsvPayload(options);
    const token = HsctisAuthService.getAccessToken();
    const jsessionId = HsctisAuthService.getJsessionId();

    const headers: Record<string, string> = {
      'Content-Type': 'text/xml',
      'User-Agent': USER_AGENT,
      Referer: `${HSCTIS_BASE}/app-nexa/index.html`,
      Accept: 'application/xml, text/xml, */*',
      'X-Requested-With': 'XMLHttpRequest',
    };

    const cookieParts: string[] = [];
    if (token) cookieParts.push(`access_token=${token}`);
    if (jsessionId) cookieParts.push(`JSESSIONID=${jsessionId}`);
    if (cookieParts.length > 0) {
      headers['Cookie'] = cookieParts.join('; ');
    }

    const resp = await HttpClient.post({
      url,
      headers,
      data: payload,
    });

    const raw = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
    const parsed = parseDatasets(raw);

    if (parsed.errorCode && parsed.errorCode !== '0' && parsed.errorCode !== '200') {
      console.warn(`Nexacro service ${serviceName} returned error: [${parsed.errorCode}] ${parsed.errorMsg}`);
    }

    return parsed;
  }

  private static initializedMenus = new Set<string>();

  public static clearMenuCache(): void {
    this.initializedMenus.clear();
  }

  /**
   * HSCTIS 각 기능(성적, 시간표, 졸업사정) 호출 전 메뉴 컨텍스트 초기화(/cs/init)
   * HAR 분석: 메뉴 접근 시 selectInitMenuData 및 selectInitMenuDataSche 호출 필요
   */
  public static async initMenu(menuCd: string, force = false): Promise<void> {
    if (!menuCd) return;
    if (!force && this.initializedMenus.has(menuCd)) {
      return;
    }

    try {
      const transInfo1 = [
        {
          id: 'selectInitMenuData',
          recvDataset: '_dsInitData',
          sqlId: 'kr.co.codefarm.svcm.cs.init.selectInitMenuData',
          fileOptions: null,
        },
      ];
      const transInfo2 = [
        {
          id: 'selectInitMenuDataSche',
          recvDataset: '_dsInitDataSche',
          sqlId: 'kr.co.codefarm.svcm.cs.init.selectInitMenuDataSche',
          fileOptions: null,
        },
      ];

      await Promise.all([
        this.postService('/cs/init', {
          variables: {
            TRANS_INFO: JSON.stringify(transInfo1),
            SYSTEM_MENU_CD: menuCd,
            SYSTEM_LOGGING: 'N',
            SYSTEM_CHECK_SCHE: 'N',
            MENU_CD: menuCd,
          },
        }),
        this.postService('/cs/init', {
          variables: {
            TRANS_INFO: JSON.stringify(transInfo2),
            SYSTEM_MENU_CD: menuCd,
            SYSTEM_LOGGING: 'N',
            SYSTEM_CHECK_SCHE: 'N',
            MENU_CD: menuCd,
          },
        }),
      ]);

      this.initializedMenus.add(menuCd);
    } catch (e) {
      console.warn(`Nexacro initMenu(${menuCd}) note:`, e);
    }
  }
}

