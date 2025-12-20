/**
 * KoKive Validation Middleware
 * 요청 검증 유틸리티
 */

const { validationResult, body, param, query } = require('express-validator');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

/**
 * 검증 결과 처리 미들웨어
 */
const handleValidation = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
            success: false,
            error: {
                code: ERROR_CODES.VALIDATION_ERROR,
                message: '입력값 검증에 실패했습니다.',
                details: errors.array().map(err => ({
                    field: err.path,
                    message: err.msg
                }))
            }
        });
    }
    next();
};

// ===========================================
// 공통 검증 규칙
// ===========================================

const validateId = param('id')
    .isInt({ min: 1 })
    .withMessage('유효한 ID를 입력해주세요.');

const validatePagination = [
    query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('페이지는 1 이상의 정수여야 합니다.'),
    query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('페이지 크기는 1-100 사이여야 합니다.')
];

// ===========================================
// 인증 관련 검증
// ===========================================

const validateSignup = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('유효한 이메일을 입력해주세요.'),
    body('password')
        .isLength({ min: 8 })
        .withMessage('비밀번호는 8자 이상이어야 합니다.'),
    body('nickname')
        .optional({ checkFalsy: true })
        .trim()
        .isLength({ min: 2, max: 20 })
        .withMessage('닉네임은 2-20자 사이여야 합니다.')
        .matches(/^[가-힣a-zA-Z0-9_]+$/)
        .withMessage('닉네임은 한글, 영문, 숫자, 밑줄만 사용할 수 있습니다.'),
    handleValidation
];

const validateLogin = [
    body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('유효한 이메일을 입력해주세요.'),
    body('password')
        .notEmpty()
        .withMessage('비밀번호를 입력해주세요.'),
    handleValidation
];

// ===========================================
// 논문 관련 검증
// ===========================================

const validatePaperId = [
    validateId,
    handleValidation
];

const validatePaperList = [
    ...validatePagination,
    query('category')
        .optional()
        .isString()
        .withMessage('카테고리는 문자열이어야 합니다.'),
    query('sort')
        .optional()
        .isIn(['latest', 'oldest', 'popular', 'views', 'saves', 'stars'])
        .withMessage('정렬 옵션이 유효하지 않습니다.'),
    query('hasCode')
        .optional()
        .isBoolean()
        .withMessage('hasCode는 boolean이어야 합니다.'),
    handleValidation
];

// ===========================================
// 검색 관련 검증
// ===========================================

const validateSearch = [
    query('q')
        .trim()
        .isLength({ min: 2, max: 200 })
        .withMessage('검색어는 2-200자 사이여야 합니다.'),
    ...validatePagination,
    handleValidation
];

// ===========================================
// Q&A 관련 검증
// ===========================================

const validateQuestion = [
    body('paperId')
        .isInt({ min: 1 })
        .withMessage('유효한 논문 ID를 입력해주세요.'),
    body('title')
        .trim()
        .isLength({ min: 5, max: 300 })
        .withMessage('제목은 5-300자 사이여야 합니다.'),
    body('content')
        .trim()
        .isLength({ min: 10, max: 10000 })
        .withMessage('내용은 10-10000자 사이여야 합니다.'),
    handleValidation
];

const validateAnswer = [
    body('content')
        .trim()
        .isLength({ min: 10, max: 10000 })
        .withMessage('답변은 10-10000자 사이여야 합니다.'),
    handleValidation
];

// ===========================================
// 라이브러리 관련 검증
// ===========================================

const validateCollection = [
    body('name')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('컬렉션 이름은 1-100자 사이여야 합니다.'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('설명은 500자 이내여야 합니다.'),
    body('isPublic')
        .optional()
        .isBoolean()
        .withMessage('공개 여부는 boolean이어야 합니다.'),
    handleValidation
];

const validateNote = [
    body('content')
        .trim()
        .isLength({ min: 1, max: 5000 })
        .withMessage('노트 내용은 1-5000자 사이여야 합니다.'),
    body('highlightText')
        .optional()
        .trim()
        .isLength({ max: 1000 })
        .withMessage('하이라이트 텍스트는 1000자 이내여야 합니다.'),
    handleValidation
];

// ===========================================
// 쇼츠폼 관련 검증
// ===========================================

const validateShorts = [
    body('paperId')
        .optional({ nullable: true })
        .isInt({ min: 1 })
        .withMessage('유효한 논문 ID를 입력해주세요.'),
    body('method')
        .optional()
        .isIn(['auto', 'manual'])
        .withMessage('유효한 생성 방식을 선택해주세요.'),
    body('title')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('제목은 200자 이내여야 합니다.'),
    handleValidation
];

const validateShortsScript = [
    body('scriptHook')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('Hook 스크립트는 200자 이내여야 합니다.'),
    body('scriptMain')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('메인 스크립트는 500자 이내여야 합니다.'),
    body('scriptCta')
        .optional()
        .trim()
        .isLength({ max: 200 })
        .withMessage('CTA 스크립트는 200자 이내여야 합니다.'),
    handleValidation
];

const validateShortsPlatform = [
    body('platform')
        .isIn(['youtube', 'instagram', 'tiktok'])
        .withMessage('유효한 플랫폼을 선택해주세요.'),
    body('videoUrl')
        .isURL()
        .withMessage('유효한 URL을 입력해주세요.'),
    body('publishedAt')
        .optional()
        .isISO8601()
        .withMessage('유효한 날짜 형식을 입력해주세요.'),
    handleValidation
];

const validateShortsStats = [
    body('date')
        .isISO8601()
        .withMessage('유효한 날짜 형식을 입력해주세요.'),
    body('views')
        .optional()
        .isInt({ min: 0 })
        .withMessage('조회수는 0 이상이어야 합니다.'),
    body('clicks')
        .optional()
        .isInt({ min: 0 })
        .withMessage('클릭수는 0 이상이어야 합니다.'),
    body('signups')
        .optional()
        .isInt({ min: 0 })
        .withMessage('가입수는 0 이상이어야 합니다.'),
    handleValidation
];

// ===========================================
// 평가 관련 검증
// ===========================================

const validateRating = [
    body('noveltyScore')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('참신성 점수는 1-5 사이여야 합니다.'),
    body('reproducibilityScore')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('재현 가능성 점수는 1-5 사이여야 합니다.'),
    body('clarityScore')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('명확성 점수는 1-5 사이여야 합니다.'),
    body('impactScore')
        .optional()
        .isInt({ min: 1, max: 5 })
        .withMessage('영향력 점수는 1-5 사이여야 합니다.'),
    body('comment')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('한줄평은 500자 이내여야 합니다.'),
    handleValidation
];

module.exports = {
    handleValidation,
    validateId,
    validatePagination,
    validateSignup,
    validateLogin,
    validatePaperId,
    validatePaperList,
    validateSearch,
    validateQuestion,
    validateAnswer,
    validateCollection,
    validateNote,
    validateShorts,
    validateShortsScript,
    validateShortsPlatform,
    validateShortsStats,
    validateRating
};
