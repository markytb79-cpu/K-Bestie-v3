/*
 * [DEACTIVATED - 베타 전환: 이메일 발송 로직 비활성화]
 * 소셜 로그인(카카오/구글) 전용 베타 운영으로 전환하여
 * SMTP 이메일 발송이 더 이상 사용되지 않음.
 * 복원 시: .env.local에 SMTP_HOST/PORT/USER/PASS/FROM 설정 후 재활성화.
 * 연관 코드:
 *   - app/api/families/[id]/invite-parent/route.ts (부모 초대 발송)
 *   - app/api/families/[id]/children/route.ts (아이 초대 발송)
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}) {
  console.log(`[EMAIL SENDING SIMULATION]
To: ${to}
Subject: ${subject}
Content: ${html}
`);

  // 만약 환경 변수에 SMTP 설정이 있으면 nodemailer로 발송 시도
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || "no-reply@k-bestie.com";

  if (host && port && user && pass) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt(port),
        secure: port === "465",
        auth: { user, pass },
      });

      await transporter.sendMail({
        from,
        to,
        subject,
        html,
      });
      console.log(`[EMAIL SENT SUCCESS] to ${to}`);
      return { sent: true };
    } catch (err: any) {
      console.error(`[EMAIL SEND ERROR] to ${to}:`, err.message);
      return { sent: false, error: err.message };
    }
  }

  return { sent: false, simulated: true };
}
