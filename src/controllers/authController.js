/**
 * KoKive Auth Controller
 * 인증 관련 비즈니스 로직 (FR-009)
 */

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { query, queryOne, insert, update } = require('../config/database');
const { generateTokens, verifyRefreshToken } = require('../middlewares/auth');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');
const oauthService = require('../services/oauthService');
const emailService = require('../services/emailService');

/**
 * 이메일 인증 토큰 생성
 */
async function createVerificationToken(userId, type = 'email_verification') {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date();

    if (type === 'email_verification') {
        expiresAt.setHours(expiresAt.getHours() + 24); // 24시간
    } else if (type === 'password_reset') {
        expiresAt.setHours(expiresAt.getHours() + 1); // 1시간
    }

    await insert('email_verification_tokens', {
        user_id: userId,
        token,
        type,
        expires_at: expiresAt
    });

    return token;
}

/**
 * 회원가입
 */
exports.signup = async (req, res, next) => {
    try {
        const { email, password } = req.body;
        // 닉네임이 없으면 이메일 앞부분으로 기본 설정
        const nickname = req.body.nickname || email.split('@')[0].substring(0, 20);

        // 이메일 중복 확인
        const existing = await queryOne('SELECT id FROM users WHERE email = ?', [email]);
        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: {
                    code: ERROR_CODES.ALREADY_EXISTS,
                    message: '이미 사용 중인 이메일입니다.'
                }
            });
        }

        // 비밀번호 해시
        const passwordHash = await bcrypt.hash(password, 10);

        // 사용자 생성 (이메일 미인증 상태)
        const userId = await insert('users', {
            email,
            password_hash: passwordHash,
            nickname,
            email_verified: false
        });

        // 기본 컬렉션 생성 (저장한 논문)
        await insert('collections', {
            user_id: userId,
            name: '저장한 논문',
            is_default: true
        });

        // 인증 토큰 생성
        const verificationToken = await createVerificationToken(userId, 'email_verification');

        // 인증 이메일 발송
        try {
            await emailService.sendVerificationEmail(email, verificationToken, nickname);
        } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
            // 이메일 발송 실패해도 회원가입은 완료
        }

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '회원가입이 완료되었습니다. 이메일을 확인하여 인증을 완료해주세요.',
            data: {
                user: {
                    id: userId,
                    email,
                    nickname,
                    emailVerified: false
                },
                requiresVerification: true
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 로그인
 */
exports.login = async (req, res, next) => {
    try {
        const { email, password } = req.body;

        // 사용자 조회
        const user = await queryOne(
            'SELECT id, email, password_hash, nickname, role, email_verified FROM users WHERE email = ?',
            [email]
        );

        if (!user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.AUTH_REQUIRED,
                    message: '이메일 또는 비밀번호가 올바르지 않습니다.'
                }
            });
        }

        // 비밀번호 확인
        const isValid = await bcrypt.compare(password, user.password_hash);
        if (!isValid) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.AUTH_REQUIRED,
                    message: '이메일 또는 비밀번호가 올바르지 않습니다.'
                }
            });
        }

        // 이메일 인증 확인
        if (!user.email_verified) {
            return res.status(HTTP_STATUS.FORBIDDEN).json({
                success: false,
                error: {
                    code: 'EMAIL_NOT_VERIFIED',
                    message: '이메일 인증이 필요합니다. 이메일을 확인해주세요.'
                },
                data: {
                    requiresVerification: true,
                    email: user.email
                }
            });
        }

        // 마지막 로그인 시간 업데이트
        await update('users', { last_login_at: new Date() }, { id: user.id });

        // 토큰 생성
        const { accessToken, refreshToken } = generateTokens({ id: user.id, email: user.email });

        res.json({
            success: true,
            message: '로그인 성공',
            data: {
                user: {
                    id: user.id,
                    email: user.email,
                    nickname: user.nickname,
                    role: user.role,
                    isAdmin: user.role === 'admin'
                },
                accessToken,
                refreshToken
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 로그아웃
 */
exports.logout = async (req, res) => {
    // 클라이언트에서 토큰 삭제 처리
    res.json({
        success: true,
        message: '로그아웃되었습니다.'
    });
};

/**
 * 토큰 갱신
 */
exports.refreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '리프레시 토큰이 필요합니다.'
                }
            });
        }

        const decoded = verifyRefreshToken(refreshToken);
        if (!decoded) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.INVALID_TOKEN,
                    message: '유효하지 않은 리프레시 토큰입니다.'
                }
            });
        }

        // 사용자 확인
        const user = await queryOne('SELECT id, email FROM users WHERE id = ?', [decoded.userId]);
        if (!user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.INVALID_TOKEN,
                    message: '존재하지 않는 사용자입니다.'
                }
            });
        }

        // 새 토큰 생성
        const tokens = generateTokens({ id: user.id, email: user.email });

        res.json({
            success: true,
            data: tokens
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 현재 사용자 정보 조회
 */
exports.getMe = async (req, res, next) => {
    try {
        const user = await queryOne(`
            SELECT id, email, nickname, profile_image_url, role, preferences, created_at, last_login_at
            FROM users WHERE id = ?
        `, [req.user.id]);

        if (!user) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: {
                    code: ERROR_CODES.NOT_FOUND,
                    message: '사용자를 찾을 수 없습니다.'
                }
            });
        }

        // preferences는 MySQL JSON 타입이므로 typeCast에 의해 이미 객체로 파싱됨
        let prefs = user.preferences;
        // 문자열인 경우에만 JSON.parse 시도
        if (typeof prefs === 'string') {
            try {
                prefs = JSON.parse(prefs);
            } catch (e) {
                prefs = null;
            }
        }

        res.json({
            success: true,
            data: {
                id: user.id,
                email: user.email,
                nickname: user.nickname,
                profileImageUrl: user.profile_image_url,
                role: user.role,
                preferences: prefs,
                createdAt: user.created_at,
                lastLoginAt: user.last_login_at
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 사용자 정보 수정
 */
exports.updateMe = async (req, res, next) => {
    try {
        const { nickname, profileImageUrl, preferences } = req.body;

        const updateData = {};
        if (nickname) updateData.nickname = nickname;
        if (profileImageUrl) updateData.profile_image_url = profileImageUrl;
        if (preferences) updateData.preferences = JSON.stringify(preferences);

        if (Object.keys(updateData).length === 0) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '수정할 정보가 없습니다.'
                }
            });
        }

        await update('users', updateData, { id: req.user.id });

        // 업데이트된 사용자 정보 반환
        const updatedUser = await queryOne(
            'SELECT id, email, nickname, profile_image_url, role, preferences FROM users WHERE id = ?',
            [req.user.id]
        );

        // preferences는 MySQL JSON 타입이므로 typeCast에 의해 이미 객체로 파싱됨
        let prefs = updatedUser.preferences;
        // 문자열인 경우에만 JSON.parse 시도
        if (typeof prefs === 'string') {
            try {
                prefs = JSON.parse(prefs);
            } catch (e) {
                prefs = null;
            }
        }

        res.json({
            success: true,
            message: '정보가 수정되었습니다.',
            data: {
                id: updatedUser.id,
                email: updatedUser.email,
                nickname: updatedUser.nickname,
                profileImageUrl: updatedUser.profile_image_url,
                role: updatedUser.role,
                preferences: prefs
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 비밀번호 변경
 */
exports.changePassword = async (req, res, next) => {
    try {
        const { currentPassword, newPassword } = req.body;

        // 현재 비밀번호 확인
        const user = await queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);

        const isValid = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValid) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '현재 비밀번호가 올바르지 않습니다.'
                }
            });
        }

        // 새 비밀번호 해시
        const newPasswordHash = await bcrypt.hash(newPassword, 10);
        await update('users', { password_hash: newPasswordHash }, { id: req.user.id });

        res.json({
            success: true,
            message: '비밀번호가 변경되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 비밀번호 찾기 (이메일 발송)
 */
exports.forgotPassword = async (req, res, next) => {
    try {
        const { email } = req.body;

        const user = await queryOne('SELECT id, nickname FROM users WHERE email = ?', [email]);

        // 보안상 존재 여부를 알려주지 않음
        if (user) {
            // 기존 토큰 삭제
            await query(
                'DELETE FROM email_verification_tokens WHERE user_id = ? AND type = ?',
                [user.id, 'password_reset']
            );

            // 새 토큰 생성
            const resetToken = await createVerificationToken(user.id, 'password_reset');

            // 이메일 발송
            try {
                await emailService.sendPasswordResetEmail(email, resetToken, user.nickname);
            } catch (emailError) {
                console.error('Failed to send password reset email:', emailError);
            }
        }

        res.json({
            success: true,
            message: '비밀번호 재설정 이메일이 발송되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 비밀번호 재설정
 */
exports.resetPassword = async (req, res, next) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '토큰과 새 비밀번호가 필요합니다.'
                }
            });
        }

        // 토큰 확인
        const tokenData = await queryOne(`
            SELECT t.*, u.email FROM email_verification_tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.token = ? AND t.type = 'password_reset' AND t.used_at IS NULL
        `, [token]);

        if (!tokenData) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: 'INVALID_TOKEN',
                    message: '유효하지 않은 토큰입니다.'
                }
            });
        }

        // 만료 확인
        if (new Date(tokenData.expires_at) < new Date()) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: 'TOKEN_EXPIRED',
                    message: '토큰이 만료되었습니다. 다시 요청해주세요.'
                }
            });
        }

        // 비밀번호 변경
        const passwordHash = await bcrypt.hash(newPassword, 10);
        await update('users', { password_hash: passwordHash }, { id: tokenData.user_id });

        // 토큰 사용 처리
        await update('email_verification_tokens', { used_at: new Date() }, { id: tokenData.id });

        res.json({
            success: true,
            message: '비밀번호가 재설정되었습니다. 새 비밀번호로 로그인해주세요.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 이메일 인증
 */
exports.verifyEmail = async (req, res, next) => {
    try {
        const { token } = req.query || req.body;

        if (!token) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '인증 토큰이 필요합니다.'
                }
            });
        }

        // 토큰 확인
        const tokenData = await queryOne(`
            SELECT t.*, u.email, u.nickname FROM email_verification_tokens t
            JOIN users u ON t.user_id = u.id
            WHERE t.token = ? AND t.type = 'email_verification' AND t.used_at IS NULL
        `, [token]);

        if (!tokenData) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: 'INVALID_TOKEN',
                    message: '유효하지 않은 인증 링크입니다.'
                }
            });
        }

        // 만료 확인
        if (new Date(tokenData.expires_at) < new Date()) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: 'TOKEN_EXPIRED',
                    message: '인증 링크가 만료되었습니다. 인증 이메일을 다시 요청해주세요.'
                }
            });
        }

        // 이메일 인증 완료
        await update('users', { email_verified: true }, { id: tokenData.user_id });

        // 토큰 사용 처리
        await update('email_verification_tokens', { used_at: new Date() }, { id: tokenData.id });

        // 환영 이메일 발송
        try {
            await emailService.sendWelcomeEmail(tokenData.email, tokenData.nickname);
        } catch (emailError) {
            console.error('Failed to send welcome email:', emailError);
        }

        res.json({
            success: true,
            message: '이메일 인증이 완료되었습니다. 이제 로그인할 수 있습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 인증 이메일 재발송
 */
exports.resendVerificationEmail = async (req, res, next) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '이메일이 필요합니다.'
                }
            });
        }

        const user = await queryOne(
            'SELECT id, nickname, email_verified FROM users WHERE email = ?',
            [email]
        );

        if (!user) {
            // 보안상 존재 여부 알려주지 않음
            return res.json({
                success: true,
                message: '인증 이메일이 발송되었습니다.'
            });
        }

        if (user.email_verified) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: 'ALREADY_VERIFIED',
                    message: '이미 인증된 이메일입니다.'
                }
            });
        }

        // 기존 토큰 삭제
        await query(
            'DELETE FROM email_verification_tokens WHERE user_id = ? AND type = ?',
            [user.id, 'email_verification']
        );

        // 새 토큰 생성
        const verificationToken = await createVerificationToken(user.id, 'email_verification');

        // 인증 이메일 발송
        try {
            await emailService.sendVerificationEmail(email, verificationToken, user.nickname);
        } catch (emailError) {
            console.error('Failed to send verification email:', emailError);
            return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
                success: false,
                error: {
                    code: 'EMAIL_SEND_FAILED',
                    message: '이메일 발송에 실패했습니다. 잠시 후 다시 시도해주세요.'
                }
            });
        }

        res.json({
            success: true,
            message: '인증 이메일이 발송되었습니다. 이메일을 확인해주세요.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * OAuth 로그인 - 제공자별 인증 URL로 리다이렉트
 */
exports.oauthLogin = async (req, res, next) => {
    try {
        const { provider } = req.params;

        // 지원하는 제공자 확인
        if (!['google', 'github'].includes(provider)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: {
                    code: ERROR_CODES.VALIDATION_ERROR,
                    message: '지원하지 않는 OAuth 제공자입니다.'
                }
            });
        }

        // state 파라미터 생성 (CSRF 방지)
        const state = uuidv4();

        // OAuth 인증 URL 생성 및 리다이렉트
        const authUrl = oauthService.getAuthUrl(provider, state);
        res.redirect(authUrl);
    } catch (error) {
        next(error);
    }
};

/**
 * OAuth 콜백 - 토큰 교환 및 사용자 생성/로그인
 */
exports.oauthCallback = async (req, res, next) => {
    try {
        const { provider } = req.params;
        const { code, error: oauthError } = req.query;

        // OAuth 에러 처리
        if (oauthError) {
            return res.redirect(`/login.html?error=${encodeURIComponent(oauthError)}`);
        }

        if (!code) {
            return res.redirect('/login.html?error=no_code');
        }

        // Access token 획득
        const accessToken = await oauthService.getAccessToken(provider, code);

        // 사용자 정보 조회
        const userInfo = await oauthService.getUserInfo(provider, accessToken);

        if (!userInfo.email) {
            return res.redirect('/login.html?error=no_email');
        }

        // 기존 OAuth 사용자 확인
        let user = await queryOne(
            'SELECT id, email, nickname, role FROM users WHERE oauth_provider = ? AND oauth_id = ?',
            [provider, userInfo.id]
        );

        if (!user) {
            // 이메일로 기존 사용자 확인
            const existingByEmail = await queryOne(
                'SELECT id, email, nickname, role, oauth_provider FROM users WHERE email = ?',
                [userInfo.email]
            );

            if (existingByEmail) {
                // 기존 이메일 사용자가 있으면 OAuth 연동
                if (!existingByEmail.oauth_provider) {
                    await update('users', {
                        oauth_provider: provider,
                        oauth_id: userInfo.id,
                        profile_image_url: userInfo.picture,
                        email_verified: true,
                        last_login_at: new Date()
                    }, { id: existingByEmail.id });
                }
                user = existingByEmail;
            } else {
                // 새 사용자 생성
                const nickname = userInfo.name || userInfo.email.split('@')[0];
                const randomPassword = uuidv4(); // OAuth 사용자는 비밀번호 불필요
                const passwordHash = await bcrypt.hash(randomPassword, 10);

                const userId = await insert('users', {
                    email: userInfo.email,
                    password_hash: passwordHash,
                    nickname: nickname,
                    oauth_provider: provider,
                    oauth_id: userInfo.id,
                    profile_image_url: userInfo.picture,
                    email_verified: true
                });

                // 기본 컬렉션 생성
                await insert('collections', {
                    user_id: userId,
                    name: '저장한 논문',
                    is_default: true
                });

                user = {
                    id: userId,
                    email: userInfo.email,
                    nickname: nickname,
                    role: 'free'
                };
            }
        } else {
            // 로그인 시간 업데이트
            await update('users', { last_login_at: new Date() }, { id: user.id });
        }

        // JWT 토큰 생성
        const tokens = generateTokens({ id: user.id, email: user.email });

        // 프론트엔드로 리다이렉트 (토큰을 쿼리 파라미터로 전달)
        const redirectUrl = `/oauth-callback.html?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}&user=${encodeURIComponent(JSON.stringify({
            id: user.id,
            email: user.email,
            nickname: user.nickname,
            role: user.role,
            isAdmin: user.role === 'admin'
        }))}`;

        res.redirect(redirectUrl);
    } catch (error) {
        console.error('OAuth callback error:', error);
        res.redirect(`/login.html?error=${encodeURIComponent(error.message)}`);
    }
};
