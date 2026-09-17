<?php

declare(strict_types=1);

namespace CampusRoom\Core;

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception as MailException;

/**
 * Mailer — sends OTP verification emails via SMTP.
 *
 * Dev mode: If SMTP_HOST or SMTP_USER is not set in .env,
 * the OTP is only written to the PHP error log (no real email).
 */
class Mailer
{
    /**
     * Send a 6-digit OTP to the given address.
     *
     * @return bool  true = email sent (or dev-mode skipped); false = SMTP failure
     */
    public static function sendOtp(string $toEmail, string $toName, string $otp): bool
    {
        $host = $_ENV['SMTP_HOST'] ?? '';
        $user = $_ENV['SMTP_USER'] ?? '';

        // ── Dev mode ────────────────────────────────────────────────────────
        // No SMTP configured → just log the OTP so the developer can copy it.
        if (empty($host) || empty($user)) {
            error_log("[CampusRoom/Mailer] DEV MODE — OTP for {$toEmail} is: {$otp}");
            return true;
        }

        // ── Production send ─────────────────────────────────────────────────
        $mail = new PHPMailer(true);
        try {
            $mail->isSMTP();
            $mail->Host       = $host;
            $mail->SMTPAuth   = true;
            $mail->Username   = $user;
            $mail->Password   = $_ENV['SMTP_PASS'] ?? '';
            $mail->SMTPSecure = PHPMailer::ENCRYPTION_STARTTLS;
            $mail->Port       = (int)($_ENV['SMTP_PORT'] ?? 587);

            $fromAddr = $_ENV['SMTP_FROM'] ?? 'noreply@campusroom.bpu.edu.ph';
            $mail->setFrom($fromAddr, 'CampusRoom BPU');
            $mail->addAddress($toEmail, $toName);

            $mail->isHTML(true);
            $mail->Subject = 'CampusRoom — Your Verification Code';
            $mail->Body    = self::buildHtml($otp, $toName);
            $mail->AltBody = "Your CampusRoom verification code is: {$otp}\nIt expires in 10 minutes. Do not share it with anyone.";

            $mail->send();
            return true;
        } catch (MailException $e) {
            error_log('[CampusRoom/Mailer] SMTP error for ' . $toEmail . ': ' . $mail->ErrorInfo);
            return false;
        }
    }

    // ── HTML email template ──────────────────────────────────────────────────

    private static function buildHtml(string $otp, string $name): string
    {
        $safeName = htmlspecialchars($name, ENT_QUOTES, 'UTF-8');
        $safeOtp  = htmlspecialchars($otp,  ENT_QUOTES, 'UTF-8');
        return <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>CampusRoom — Verification Code</title>
</head>
<body style="margin:0;padding:24px;background:#f8f9fb;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;">
    <tr><td>
      <!-- Header -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#5b0617;border-radius:12px 12px 0 0;overflow:hidden;">
        <tr>
          <td style="padding:28px 32px;text-align:center;">
            <p style="margin:0 0 4px;color:#ffc641;font-size:11px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;">
              Buenavista Polytechnic University
            </p>
            <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:700;">CampusRoom</h1>
          </td>
        </tr>
      </table>
      <!-- Body -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#ffffff;border-left:1px solid #e1e2e4;border-right:1px solid #e1e2e4;">
        <tr>
          <td style="padding:32px;">
            <p style="margin:0 0 12px;font-size:15px;color:#191c1e;line-height:1.6;">
              Hello, <strong>{$safeName}</strong>!
            </p>
            <p style="margin:0 0 24px;font-size:15px;color:#191c1e;line-height:1.6;">
              Use the code below to verify your CampusRoom account.
              It will expire in <strong>10 minutes</strong>.
            </p>
            <!-- OTP box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#f3f4f6;border:2px solid #dcc0c0;border-radius:10px;
                            text-align:center;padding:20px;">
                  <span style="font-size:40px;font-weight:700;letter-spacing:.2em;
                                color:#5b0617;font-family:monospace;">{$safeOtp}</span>
                  <p style="margin:6px 0 0;font-size:12px;color:#564242;">
                    Do not share this code with anyone.
                  </p>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;font-size:13px;color:#897172;line-height:1.5;">
              If you did not create a CampusRoom account, you can safely ignore this email.
            </p>
          </td>
        </tr>
      </table>
      <!-- Footer -->
      <table width="100%" cellpadding="0" cellspacing="0"
             style="background:#f3f4f6;border:1px solid #e1e2e4;border-top:none;
                    border-radius:0 0 12px 12px;">
        <tr>
          <td style="padding:14px 32px;text-align:center;font-size:12px;color:#897172;">
            &copy; 2024 Buenavista Polytechnic University &bull; CampusRoom Facility Reservation System
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>
HTML;
    }
}
