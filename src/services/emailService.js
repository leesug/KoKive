/**
 * KoKive Email Service
 * 이메일 발송 서비스 (회원가입 인증, 비밀번호 재설정 등)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// IIS SMTP Pickup 디렉토리 (Windows)
const PICKUP_DIR = process.env.SMTP_PICKUP_DIR || 'C:\\inetpub\\mailroot\\Pickup';

/**
 * 이메일 발송 (IIS SMTP Pickup 디렉토리 방식)
 */
async function sendEmail({ to, subject, html, text }) {
    const fromEmail = process.env.SMTP_FROM || 'noreply@kokive.com';
    const messageId = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}@kokive.com`;

    // EML 파일 내용 생성
    const boundary = `----=_Part_${crypto.randomBytes(8).toString('hex')}`;

    const emlContent = [
        `From: "KoKive" <${fromEmail}>`,
        `To: ${to}`,
        `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=`,
        `Message-ID: <${messageId}>`,
        `Date: ${new Date().toUTCString()}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        ``,
        `--${boundary}`,
        `Content-Type: text/plain; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        Buffer.from(text || '').toString('base64'),
        ``,
        `--${boundary}`,
        `Content-Type: text/html; charset=UTF-8`,
        `Content-Transfer-Encoding: base64`,
        ``,
        Buffer.from(html || '').toString('base64'),
        ``,
        `--${boundary}--`
    ].join('\r\n');

    // Pickup 디렉토리에 .eml 파일 생성
    const filename = `kokive_${messageId.replace('@kokive.com', '')}.eml`;
    const filepath = path.join(PICKUP_DIR, filename);

    try {
        // Pickup 디렉토리 존재 확인
        if (!fs.existsSync(PICKUP_DIR)) {
            throw new Error(`SMTP Pickup directory not found: ${PICKUP_DIR}`);
        }

        fs.writeFileSync(filepath, emlContent, 'utf8');
        console.log('Email queued:', messageId, 'to:', to);

        return { messageId, accepted: [to] };
    } catch (error) {
        console.error('Email queue error:', error);
        throw error;
    }
}

/**
 * 회원가입 인증 이메일 발송
 */
async function sendVerificationEmail(email, token, nickname) {
    const baseUrl = process.env.BASE_URL || 'https://kokive.com';
    const verifyUrl = `${baseUrl}/verify-email.html?token=${token}`;

    const subject = '[KoKive] 이메일 인증을 완료해주세요';

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #646cff; font-size: 32px; margin: 0;">KoKive</h1>
            <p style="color: #a1a1aa; font-size: 14px; margin-top: 8px;">AI 논문 번역 플랫폼</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #18181b; border-radius: 16px; padding: 32px; border: 1px solid #27272a;">
            <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 16px 0;">
                안녕하세요${nickname ? `, ${nickname}님` : ''}! 👋
            </h2>

            <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                KoKive 회원가입을 환영합니다!<br>
                아래 버튼을 클릭하여 이메일 인증을 완료해주세요.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${verifyUrl}"
                   style="display: inline-block; background: linear-gradient(135deg, #646cff 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                    이메일 인증하기
                </a>
            </div>

            <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣기 해주세요:
            </p>
            <p style="color: #646cff; font-size: 14px; word-break: break-all; margin: 8px 0 0 0;">
                ${verifyUrl}
            </p>

            <!-- Warning -->
            <div style="background-color: #27272a; border-radius: 8px; padding: 16px; margin-top: 24px;">
                <p style="color: #fbbf24; font-size: 14px; margin: 0;">
                    ⚠️ 이 링크는 24시간 후 만료됩니다.
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px;">
            <p style="color: #52525b; font-size: 12px; margin: 0;">
                이 이메일을 요청하지 않으셨다면 무시하셔도 됩니다.
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                © 2024 KoKive. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
KoKive 이메일 인증

안녕하세요${nickname ? `, ${nickname}님` : ''}!

KoKive 회원가입을 환영합니다!
아래 링크를 클릭하여 이메일 인증을 완료해주세요:

${verifyUrl}

이 링크는 24시간 후 만료됩니다.

이 이메일을 요청하지 않으셨다면 무시하셔도 됩니다.

© 2024 KoKive. All rights reserved.
    `;

    return sendEmail({ to: email, subject, html, text });
}

/**
 * 비밀번호 재설정 이메일 발송
 */
async function sendPasswordResetEmail(email, token, nickname) {
    const baseUrl = process.env.BASE_URL || 'https://kokive.com';
    const resetUrl = `${baseUrl}/reset-password.html?token=${token}`;

    const subject = '[KoKive] 비밀번호 재설정';

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #646cff; font-size: 32px; margin: 0;">KoKive</h1>
            <p style="color: #a1a1aa; font-size: 14px; margin-top: 8px;">AI 논문 번역 플랫폼</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #18181b; border-radius: 16px; padding: 32px; border: 1px solid #27272a;">
            <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 16px 0;">
                비밀번호 재설정 요청 🔐
            </h2>

            <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                ${nickname ? `${nickname}님,` : ''} 비밀번호 재설정 요청이 접수되었습니다.<br>
                아래 버튼을 클릭하여 새 비밀번호를 설정해주세요.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${resetUrl}"
                   style="display: inline-block; background: linear-gradient(135deg, #646cff 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                    비밀번호 재설정
                </a>
            </div>

            <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣기 해주세요:
            </p>
            <p style="color: #646cff; font-size: 14px; word-break: break-all; margin: 8px 0 0 0;">
                ${resetUrl}
            </p>

            <!-- Warning -->
            <div style="background-color: #27272a; border-radius: 8px; padding: 16px; margin-top: 24px;">
                <p style="color: #fbbf24; font-size: 14px; margin: 0;">
                    ⚠️ 이 링크는 1시간 후 만료됩니다.
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px;">
            <p style="color: #52525b; font-size: 12px; margin: 0;">
                비밀번호 재설정을 요청하지 않으셨다면, 이 이메일을 무시하시거나<br>
                계정 보안을 위해 즉시 문의해주세요.
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                © 2024 KoKive. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
KoKive 비밀번호 재설정

${nickname ? `${nickname}님,` : ''} 비밀번호 재설정 요청이 접수되었습니다.
아래 링크를 클릭하여 새 비밀번호를 설정해주세요:

${resetUrl}

이 링크는 1시간 후 만료됩니다.

비밀번호 재설정을 요청하지 않으셨다면, 이 이메일을 무시하시거나
계정 보안을 위해 즉시 문의해주세요.

© 2024 KoKive. All rights reserved.
    `;

    return sendEmail({ to: email, subject, html, text });
}

/**
 * 뉴스레터 이메일 발송
 * @param {string} to - 수신자 이메일
 * @param {string} subject - 이메일 제목
 * @param {Array} papers - 논문 목록
 * @param {string} unsubscribeToken - 구독 해지 토큰
 */
// authors 필드를 문자열로 변환하는 헬퍼 함수
function formatAuthors(authors, maxLength = 100) {
    if (!authors) return '';
    try {
        let authorsStr = '';
        if (Array.isArray(authors)) {
            // 배열인 경우
            if (authors.length > 0 && typeof authors[0] === 'string') {
                // 문자열 배열: ["Author1", "Author2"]
                authorsStr = authors.join(', ');
            } else {
                // 객체 배열: [{name: "Author1"}, ...]
                authorsStr = authors.map(a => a.name || ((a.firstName || '') + ' ' + (a.lastName || '')).trim()).filter(n => n).join(', ');
            }
        } else if (typeof authors === 'string') {
            authorsStr = authors;
        }
        return authorsStr.substring(0, maxLength) + (authorsStr.length > maxLength ? '...' : '');
    } catch (e) {
        return '';
    }
}

async function sendNewsletterEmail(to, subject, papers, unsubscribeToken) {
    const baseUrl = process.env.BASE_URL || 'https://kokive.com';
    const unsubscribeUrl = `${baseUrl}/unsubscribe.html?token=${unsubscribeToken}`;

    // 논문 목록 HTML 생성
    const papersHtml = papers.map(paper => `
        <div style="background-color: #27272a; border-radius: 12px; padding: 20px; margin-bottom: 16px; border-left: 4px solid #646cff;">
            <h3 style="color: #ffffff; font-size: 16px; margin: 0 0 8px 0; line-height: 1.4;">
                <a href="${baseUrl}/paper.html?id=${paper.id}" style="color: #ffffff; text-decoration: none;">
                    ${paper.title_ko || paper.title}
                </a>
            </h3>
            <p style="color: #a1a1aa; font-size: 13px; margin: 0 0 8px 0;">
                ${formatAuthors(paper.authors)}
            </p>
            <p style="color: #71717a; font-size: 12px; margin: 0;">
                ${paper.category || ''} · ${new Date(paper.published_date || paper.created_at).toLocaleDateString('ko-KR')}
            </p>
            ${paper.summary_ko ? `
            <p style="color: #a1a1aa; font-size: 14px; line-height: 1.6; margin: 12px 0 0 0;">
                ${paper.summary_ko.substring(0, 200)}${paper.summary_ko.length > 200 ? '...' : ''}
            </p>
            ` : ''}
        </div>
    `).join('');

    // 논문 목록 텍스트 생성
    const papersText = papers.map(paper => `
📄 ${paper.title_ko || paper.title}
   ${formatAuthors(paper.authors)}
   ${paper.category || ''} · ${new Date(paper.published_date || paper.created_at).toLocaleDateString('ko-KR')}
   ${baseUrl}/paper.html?id=${paper.id}
`).join('\n');

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #646cff; font-size: 32px; margin: 0;">KoKive</h1>
            <p style="color: #a1a1aa; font-size: 14px; margin-top: 8px;">AI 논문 번역 플랫폼</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #18181b; border-radius: 16px; padding: 32px; border: 1px solid #27272a;">
            <h2 style="color: #ffffff; font-size: 20px; margin: 0 0 8px 0;">
                📚 ${subject.replace('[KoKive] ', '')}
            </h2>
            <p style="color: #a1a1aa; font-size: 14px; margin: 0 0 24px 0;">
                관심 분야의 새로운 논문 ${papers.length}편을 소개합니다.
            </p>

            <!-- Papers List -->
            ${papersHtml}

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0 16px 0;">
                <a href="${baseUrl}/papers.html"
                   style="display: inline-block; background: linear-gradient(135deg, #646cff 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 14px 40px; border-radius: 12px; font-size: 14px; font-weight: 600;">
                    더 많은 논문 보기
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px;">
            <p style="color: #52525b; font-size: 12px; margin: 0;">
                이 이메일은 KoKive 뉴스레터 구독자에게 발송되었습니다.
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                <a href="${unsubscribeUrl}" style="color: #646cff; text-decoration: none;">구독 해지</a> ·
                <a href="${baseUrl}/settings.html" style="color: #646cff; text-decoration: none;">설정 변경</a>
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                © 2024 KoKive. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
${subject}

관심 분야의 새로운 논문 ${papers.length}편을 소개합니다.

${papersText}

더 많은 논문 보기: ${baseUrl}/papers.html

---
이 이메일은 KoKive 뉴스레터 구독자에게 발송되었습니다.
구독 해지: ${unsubscribeUrl}

© 2024 KoKive. All rights reserved.
    `;

    return sendEmail({ to, subject, html, text });
}

/**
 * 뉴스레터 구독 확인 이메일 발송
 */
async function sendNewsletterVerificationEmail(email, token) {
    const baseUrl = process.env.BASE_URL || 'https://kokive.com';
    const verifyUrl = `${baseUrl}/verify-newsletter.html?token=${token}`;

    const subject = '[KoKive] 뉴스레터 구독 확인';

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #646cff; font-size: 32px; margin: 0;">KoKive</h1>
            <p style="color: #a1a1aa; font-size: 14px; margin-top: 8px;">AI 논문 번역 플랫폼</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #18181b; border-radius: 16px; padding: 32px; border: 1px solid #27272a;">
            <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 16px 0;">
                뉴스레터 구독 확인 📬
            </h2>

            <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0;">
                KoKive 뉴스레터 구독을 신청해 주셔서 감사합니다!<br>
                아래 버튼을 클릭하여 구독을 확인해주세요.
            </p>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${verifyUrl}"
                   style="display: inline-block; background: linear-gradient(135deg, #646cff 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                    구독 확인하기
                </a>
            </div>

            <p style="color: #71717a; font-size: 14px; line-height: 1.6; margin: 24px 0 0 0;">
                버튼이 작동하지 않으면 아래 링크를 복사하여 브라우저에 붙여넣기 해주세요:
            </p>
            <p style="color: #646cff; font-size: 14px; word-break: break-all; margin: 8px 0 0 0;">
                ${verifyUrl}
            </p>

            <!-- Info -->
            <div style="background-color: #27272a; border-radius: 8px; padding: 16px; margin-top: 24px;">
                <p style="color: #a1a1aa; font-size: 14px; margin: 0;">
                    ℹ️ 뉴스레터를 통해 관심 분야의 최신 AI 논문을 받아보실 수 있습니다.
                </p>
            </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px;">
            <p style="color: #52525b; font-size: 12px; margin: 0;">
                이 이메일을 요청하지 않으셨다면 무시하셔도 됩니다.
            </p>
            <p style="color: #52525b; font-size: 12px; margin: 8px 0 0 0;">
                © 2024 KoKive. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
KoKive 뉴스레터 구독 확인

KoKive 뉴스레터 구독을 신청해 주셔서 감사합니다!
아래 링크를 클릭하여 구독을 확인해주세요:

${verifyUrl}

뉴스레터를 통해 관심 분야의 최신 AI 논문을 받아보실 수 있습니다.

이 이메일을 요청하지 않으셨다면 무시하셔도 됩니다.

© 2024 KoKive. All rights reserved.
    `;

    return sendEmail({ to: email, subject, html, text });
}

/**
 * 인증 완료 환영 이메일 발송
 */
async function sendWelcomeEmail(email, nickname) {
    const baseUrl = process.env.BASE_URL || 'https://kokive.com';

    const subject = '[KoKive] 가입을 환영합니다! 🎉';

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0a0f;">
    <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
        <!-- Header -->
        <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #646cff; font-size: 32px; margin: 0;">KoKive</h1>
            <p style="color: #a1a1aa; font-size: 14px; margin-top: 8px;">AI 논문 번역 플랫폼</p>
        </div>

        <!-- Main Content -->
        <div style="background-color: #18181b; border-radius: 16px; padding: 32px; border: 1px solid #27272a;">
            <h2 style="color: #ffffff; font-size: 24px; margin: 0 0 16px 0; text-align: center;">
                🎉 이메일 인증 완료!
            </h2>

            <p style="color: #a1a1aa; font-size: 16px; line-height: 1.6; margin: 0 0 24px 0; text-align: center;">
                ${nickname ? `${nickname}님,` : ''} 이메일 인증이 완료되었습니다!<br>
                이제 KoKive의 모든 기능을 이용하실 수 있습니다.
            </p>

            <!-- Features -->
            <div style="background-color: #27272a; border-radius: 12px; padding: 24px; margin: 24px 0;">
                <h3 style="color: #ffffff; font-size: 16px; margin: 0 0 16px 0;">KoKive에서 할 수 있는 것들:</h3>
                <ul style="color: #a1a1aa; font-size: 14px; line-height: 1.8; margin: 0; padding-left: 20px;">
                    <li>최신 AI/ML 논문을 한국어로 읽기</li>
                    <li>AI가 생성한 요약으로 빠르게 핵심 파악</li>
                    <li>관심 논문을 라이브러리에 저장</li>
                    <li>컬렉션으로 논문 정리</li>
                </ul>
            </div>

            <!-- CTA Button -->
            <div style="text-align: center; margin: 32px 0;">
                <a href="${baseUrl}/papers.html"
                   style="display: inline-block; background: linear-gradient(135deg, #646cff 0%, #8b5cf6 100%); color: #ffffff; text-decoration: none; padding: 16px 48px; border-radius: 12px; font-size: 16px; font-weight: 600;">
                    논문 둘러보기
                </a>
            </div>
        </div>

        <!-- Footer -->
        <div style="text-align: center; margin-top: 32px;">
            <p style="color: #52525b; font-size: 12px; margin: 0;">
                © 2024 KoKive. All rights reserved.
            </p>
        </div>
    </div>
</body>
</html>
    `;

    const text = `
KoKive 가입을 환영합니다! 🎉

${nickname ? `${nickname}님,` : ''} 이메일 인증이 완료되었습니다!
이제 KoKive의 모든 기능을 이용하실 수 있습니다.

KoKive에서 할 수 있는 것들:
- 최신 AI/ML 논문을 한국어로 읽기
- AI가 생성한 요약으로 빠르게 핵심 파악
- 관심 논문을 라이브러리에 저장
- 컬렉션으로 논문 정리

지금 바로 시작하세요: ${baseUrl}/papers.html

© 2024 KoKive. All rights reserved.
    `;

    return sendEmail({ to: email, subject, html, text });
}

module.exports = {
    sendEmail,
    sendVerificationEmail,
    sendPasswordResetEmail,
    sendWelcomeEmail,
    sendNewsletterEmail,
    sendNewsletterVerificationEmail
};
