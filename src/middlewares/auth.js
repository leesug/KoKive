/**
 * KoKive Authentication Middleware
 * JWT 검증 및 권한 확인
 */

const jwt = require('jsonwebtoken');
const { queryOne } = require('../config/database');
const { HTTP_STATUS, ERROR_CODES, USER_ROLES } = require('../config/constants');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

/**
 * JWT 토큰 검증 미들웨어
 * 인증이 필요한 라우트에 사용
 */
const authenticate = async (req, res, next) => {
    try {
        // Authorization 헤더에서 토큰 추출
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.AUTH_REQUIRED,
                    message: '인증이 필요합니다.'
                }
            });
        }

        const token = authHeader.substring(7);  // 'Bearer ' 제거

        // 토큰 검증
        let decoded;
        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch (err) {
            if (err.name === 'TokenExpiredError') {
                return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                    success: false,
                    error: {
                        code: ERROR_CODES.TOKEN_EXPIRED,
                        message: '토큰이 만료되었습니다. 다시 로그인해주세요.'
                    }
                });
            }
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.INVALID_TOKEN,
                    message: '유효하지 않은 토큰입니다.'
                }
            });
        }

        // 사용자 정보 조회
        const user = await queryOne(
            'SELECT id, email, nickname, role FROM users WHERE id = ?',
            [decoded.userId]
        );

        if (!user) {
            return res.status(HTTP_STATUS.UNAUTHORIZED).json({
                success: false,
                error: {
                    code: ERROR_CODES.INVALID_TOKEN,
                    message: '존재하지 않는 사용자입니다.'
                }
            });
        }

        // 요청에 사용자 정보 추가
        req.user = {
            id: user.id,
            email: user.email,
            nickname: user.nickname,
            role: user.role,
            isAdmin: user.role === 'admin'
        };

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(HTTP_STATUS.INTERNAL_ERROR).json({
            success: false,
            error: {
                code: ERROR_CODES.INTERNAL_ERROR,
                message: '인증 처리 중 오류가 발생했습니다.'
            }
        });
    }
};

/**
 * 선택적 인증 미들웨어
 * 토큰이 있으면 검증하고, 없어도 진행
 */
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            req.user = null;
            return next();
        }

        const token = authHeader.substring(7);

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = await queryOne(
                'SELECT id, email, nickname, role FROM users WHERE id = ?',
                [decoded.userId]
            );

            if (user) {
                req.user = {
                    id: user.id,
                    email: user.email,
                    nickname: user.nickname,
                    role: user.role,
                    isAdmin: user.role === 'admin'
                };
            } else {
                req.user = null;
            }
        } catch {
            req.user = null;
        }

        next();
    } catch (error) {
        req.user = null;
        next();
    }
};

/**
 * 관리자 권한 확인 미들웨어
 * authenticate 미들웨어 다음에 사용
 */
const requireAdmin = (req, res, next) => {
    if (!req.user || !req.user.isAdmin) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
            success: false,
            error: {
                code: ERROR_CODES.INSUFFICIENT_PERMISSION,
                message: '관리자 권한이 필요합니다.'
            }
        });
    }
    next();
};

/**
 * Basic 이상 권한 확인 미들웨어 (Basic, Pro, Admin 허용)
 */
const requireBasic = (req, res, next) => {
    if (!req.user || (req.user.role !== USER_ROLES.BASIC && req.user.role !== USER_ROLES.PRO && req.user.role !== USER_ROLES.ADMIN)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
            success: false,
            error: {
                code: ERROR_CODES.INSUFFICIENT_PERMISSION,
                message: 'Basic 이상 등급이 필요합니다.'
            }
        });
    }
    next();
};

/**
 * Pro 이상 권한 확인 미들웨어 (Pro, Admin만 허용)
 */
const requirePro = (req, res, next) => {
    if (!req.user || (req.user.role !== USER_ROLES.PRO && req.user.role !== USER_ROLES.ADMIN)) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
            success: false,
            error: {
                code: ERROR_CODES.INSUFFICIENT_PERMISSION,
                message: 'Pro 이상 등급이 필요합니다.'
            }
        });
    }
    next();
};

/**
 * JWT 토큰 생성
 * @param {Object} user - 사용자 정보
 * @returns {Object} 액세스 토큰과 리프레시 토큰
 */
const generateTokens = (user) => {
    const accessToken = jwt.sign(
        { userId: user.id, email: user.email },
        JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    const refreshToken = jwt.sign(
        { userId: user.id },
        process.env.JWT_REFRESH_SECRET || 'refresh-secret',
        { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d' }
    );

    return { accessToken, refreshToken };
};

/**
 * 리프레시 토큰 검증
 * @param {string} refreshToken - 리프레시 토큰
 * @returns {Object|null} 디코딩된 토큰 또는 null
 */
const verifyRefreshToken = (refreshToken) => {
    try {
        return jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'refresh-secret');
    } catch {
        return null;
    }
};

module.exports = {
    authenticate,
    optionalAuth,
    requireAdmin,
    requireBasic,
    requirePro,
    generateTokens,
    verifyRefreshToken
};
