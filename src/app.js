/**
 * KoKive Application Entry Point
 * Express 서버 초기화 및 설정
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const { testConnection } = require('./config/database');
const { HTTP_STATUS } = require('./config/constants');

// 라우터 임포트
const paperRoutes = require('./routes/paperRoutes');
const authRoutes = require('./routes/authRoutes');
const searchRoutes = require('./routes/searchRoutes');
const termRoutes = require('./routes/termRoutes');
const communityRoutes = require('./routes/communityRoutes');
const libraryRoutes = require('./routes/libraryRoutes');
const shortsRoutes = require('./routes/shortsRoutes');
const newsletterRoutes = require('./routes/newsletterRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const melottsRoutes = require('./routes/melottsRoutes');

const statsRoutes = require('./routes/statsRoutes');
// Express 앱 생성
const app = express();
const PORT = process.env.PORT || 8081;

// IIS/Proxy 환경에서 클라이언트 IP 정확히 가져오기
app.set('trust proxy', true);

// ===========================================
// 미들웨어 설정
// ===========================================

// 보안 헤더
app.use(helmet({
    contentSecurityPolicy: false,  // 개발 환경에서 비활성화
    crossOriginEmbedderPolicy: false
}));

// CORS 설정
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 요청 압축
app.use(compression());

// 요청 파싱
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// 로깅 (개발 환경에서만 상세 로그)
if (process.env.NODE_ENV === 'development') {
    app.use(morgan('dev'));
} else {
    app.use(morgan('combined'));
}

// Rate Limiting - IIS/iisnode 환경에서 비활성화 (IP 가져오기 문제)
// const limiter = rateLimit({
//     windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
//     max: parseInt(process.env.RATE_LIMIT_MAX) || 100,
//     message: {
//         success: false,
//         error: {
//             code: 'RATE_LIMIT_EXCEEDED',
//             message: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.'
//         }
//     },
//     standardHeaders: true,
//     legacyHeaders: false
// });
// app.use('/api/', limiter);

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '../public')));

// ===========================================
// API 라우트
// ===========================================

// 헬스 체크
app.get('/api/health', async (req, res) => {
    const dbConnected = await testConnection();
    res.json({
        success: true,
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: dbConnected ? 'connected' : 'disconnected',
        version: '3.0.0'
    });
});

// API 버전 프리픽스
const API_V1 = '/api/v1';

// 라우트 등록
app.use(`${API_V1}/papers`, paperRoutes);
app.use(`${API_V1}/auth`, authRoutes);
app.use(`${API_V1}/search`, searchRoutes);
app.use(`${API_V1}/terms`, termRoutes);
app.use(`${API_V1}/community`, communityRoutes);
app.use(`${API_V1}/library`, libraryRoutes);
app.use(`${API_V1}/shorts`, shortsRoutes);
app.use(`${API_V1}/newsletter`, newsletterRoutes);
app.use(`${API_V1}/stats`, statsRoutes);
app.use(`${API_V1}/payment`, paymentRoutes);

// 관리자 라우트
app.use('/api/admin', adminRoutes);

// MeloTTS 라우트
app.use('/api/melotts', melottsRoutes);

// ===========================================
// 에러 핸들링
// ===========================================

// 404 핸들러
app.use((req, res, next) => {
    // API 요청인 경우 JSON 응답
    if (req.path.startsWith('/api')) {
        return res.status(HTTP_STATUS.NOT_FOUND).json({
            success: false,
            error: {
                code: 'NOT_FOUND',
                message: '요청한 리소스를 찾을 수 없습니다.',
                path: req.path
            }
        });
    }
    // 그 외는 index.html 서빙 (SPA 지원)
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// 글로벌 에러 핸들러
app.use((err, req, res, next) => {
    console.error('Error:', err);

    // 개발 환경에서는 스택 트레이스 포함
    const isDev = process.env.NODE_ENV === 'development';

    // 에러 유형에 따른 상태 코드 결정
    let statusCode = err.statusCode || HTTP_STATUS.INTERNAL_ERROR;
    let errorCode = err.code || 'INTERNAL_ERROR';

    // 특정 에러 유형 처리
    if (err.name === 'ValidationError') {
        statusCode = HTTP_STATUS.BAD_REQUEST;
        errorCode = 'VALIDATION_ERROR';
    } else if (err.name === 'UnauthorizedError' || err.message === 'jwt expired') {
        statusCode = HTTP_STATUS.UNAUTHORIZED;
        errorCode = 'INVALID_TOKEN';
    }

    res.status(statusCode).json({
        success: false,
        error: {
            code: errorCode,
            message: err.message || '서버 오류가 발생했습니다.',
            ...(isDev && { stack: err.stack })
        }
    });
});

// ===========================================
// 서버 시작
// ===========================================

async function startServer() {
    try {
        // 데이터베이스 연결 테스트
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.warn('⚠️  데이터베이스 연결 실패, 서버는 계속 실행됩니다.');
        }

        // 서버 시작
        app.listen(PORT, () => {
            console.log('');
            console.log('╔══════════════════════════════════════════════╗');
            console.log('║           🚀 KoKive Server v3.0              ║');
            console.log('╠══════════════════════════════════════════════╣');
            console.log(`║  환경: ${(process.env.NODE_ENV || 'development').padEnd(38)}║`);
            console.log(`║  포트: ${String(PORT).padEnd(38)}║`);
            console.log(`║  URL:  http://localhost:${String(PORT).padEnd(21)}║`);
            console.log('╠══════════════════════════════════════════════╣');
            console.log('║  API 엔드포인트:                              ║');
            console.log('║  • /api/health          - 헬스 체크           ║');
            console.log('║  • /api/v1/papers       - 논문 API            ║');
            console.log('║  • /api/v1/auth         - 인증 API            ║');
            console.log('║  • /api/v1/search       - 검색 API            ║');
            console.log('║  • /api/v1/terms        - 용어 API            ║');
            console.log('║  • /api/v1/community    - Q&A API             ║');
            console.log('║  • /api/v1/library      - 라이브러리 API      ║');
            console.log('║  • /api/v1/shorts       - 쇼츠폼 API          ║');
            console.log('║  • /api/v1/newsletter   - 뉴스레터 API        ║');
            console.log('║  • /api/admin           - 관리자 API          ║');
            console.log('╚══════════════════════════════════════════════╝');
            console.log('');
        });

    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

// 서버 시작
startServer();

// 배치 작업 스케줄러 시작
const { startAllJobs } = require('./jobs');
if (process.env.ENABLE_SCHEDULERS !== 'false') {
    startAllJobs();
}

// Graceful Shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM 시그널 수신, 서버 종료 중...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT 시그널 수신, 서버 종료 중...');
    process.exit(0);
});

module.exports = app;
