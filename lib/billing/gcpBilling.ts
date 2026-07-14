// GCP billing_export(BigQuery) 조회 — STT/TTS 실제 청구액(SKU별)을 가져온다.
// 필요 환경변수:
//   GCP_BILLING_PROJECT_ID   billing_export가 있는 GCP 프로젝트 (예: K-Bestie3)
//   GCP_BILLING_DATASET      billing_export 데이터세트명
//   GCP_BILLING_SA_KEY_JSON  조회 전용 서비스 계정 키(JSON 전체를 문자열로)
// 서비스 계정 필요 권한: 해당 데이터세트에 BigQuery Data Viewer + 프로젝트에 BigQuery Job User.
// 환경변수가 없으면 조회를 시도하지 않고 "설정 안 됨" 상태를 반환한다(대시보드가 깨지지 않도록).

import { BigQuery } from "@google-cloud/bigquery";

const SERVICE_SKU_LABEL: Record<string, "stt" | "tts"> = {
  "Cloud Speech-to-Text API": "stt",
  "Cloud Speech-to-Text": "stt",
  "Cloud Text-to-Speech API": "tts",
  "Cloud Text-to-Speech": "tts",
};

export interface GcpBillingDayRow {
  day: string; // YYYY-MM-DD
  service: "stt" | "tts";
  costKrw: number;
}

export interface GcpBillingResult {
  configured: boolean;
  error?: string;
  rows: GcpBillingDayRow[];
  totalsByService: { stt: number; tts: number };
  /** GCP billing export는 통상 하루 지연되어 반영된다 — 이 날짜(오늘) 이후 데이터는 "집계 중"으로 취급. */
  dataCutoffDate: string;
}

const USD_TO_KRW = 1400;

let cachedClient: BigQuery | null = null;
let cachedBillingTable: string | null = null;

function getClient(): BigQuery | null {
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const keyJson = process.env.GCP_BILLING_SA_KEY_JSON;
  if (!projectId || !keyJson) return null;

  if (!cachedClient) {
    const credentials = JSON.parse(keyJson);
    cachedClient = new BigQuery({ projectId, credentials });
  }
  return cachedClient;
}

async function resolveBillingTable(client: BigQuery, dataset: string): Promise<string | null> {
  if (cachedBillingTable) return cachedBillingTable;

  const [rows] = await client.query({
    query: `
      SELECT table_name
      FROM \`${dataset}.INFORMATION_SCHEMA.TABLES\`
      WHERE table_name LIKE 'gcp_billing_export%'
      ORDER BY table_name DESC
      LIMIT 1
    `,
  });
  const tableName = (rows?.[0] as { table_name?: string } | undefined)?.table_name;
  if (!tableName) return null;
  cachedBillingTable = tableName;
  return tableName;
}

/** STT/TTS 실제 청구액(일자·서비스별)을 [from, to) 기간으로 조회. */
export async function fetchGcpBilling(input: { from: Date; to: Date }): Promise<GcpBillingResult> {
  const today = new Date().toISOString().slice(0, 10);
  const projectId = process.env.GCP_BILLING_PROJECT_ID;
  const dataset = process.env.GCP_BILLING_DATASET;

  const client = getClient();
  if (!client || !projectId || !dataset) {
    return {
      configured: false,
      rows: [],
      totalsByService: { stt: 0, tts: 0 },
      dataCutoffDate: today,
    };
  }

  try {
    const table = await resolveBillingTable(client, `${projectId}.${dataset}`);
    if (!table) {
      return {
        configured: false,
        error: "billing_export 테이블을 찾을 수 없습니다",
        rows: [],
        totalsByService: { stt: 0, tts: 0 },
        dataCutoffDate: today,
      };
    }

    const skuNames = Object.keys(SERVICE_SKU_LABEL);
    const [rows] = await client.query({
      query: `
        SELECT
          FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time)) AS day,
          service.description AS service_desc,
          SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS cost_usd
        FROM \`${projectId}.${dataset}.${table}\`
        WHERE service.description IN UNNEST(@skuNames)
          AND usage_start_time >= @from
          AND usage_start_time < @to
        GROUP BY day, service_desc
        ORDER BY day ASC
      `,
      params: { skuNames, from: input.from.toISOString(), to: input.to.toISOString() },
    });

    const totalsByService = { stt: 0, tts: 0 };
    const resultRows: GcpBillingDayRow[] = [];
    for (const r of rows as Array<{ day: string; service_desc: string; cost_usd: number }>) {
      const service = SERVICE_SKU_LABEL[r.service_desc];
      if (!service) continue;
      const costKrw = (r.cost_usd ?? 0) * USD_TO_KRW;
      totalsByService[service] += costKrw;
      resultRows.push({ day: r.day, service, costKrw });
    }

    return { configured: true, rows: resultRows, totalsByService, dataCutoffDate: today };
  } catch (err) {
    return {
      configured: true,
      error: (err as Error).message,
      rows: [],
      totalsByService: { stt: 0, tts: 0 },
      dataCutoffDate: today,
    };
  }
}
