/**
 * KoKive Constants
 * 시스템 전역 상수 정의
 */

// 논문 카테고리 (arXiv)
const PAPER_CATEGORIES = {
    'cs.AI': { name: 'Artificial Intelligence', nameKo: '인공지능' },
    'cs.CL': { name: 'Computation and Language', nameKo: '자연어처리' },
    'cs.CV': { name: 'Computer Vision', nameKo: '컴퓨터 비전' },
    'cs.LG': { name: 'Machine Learning', nameKo: '머신러닝' },
    'cs.NE': { name: 'Neural and Evolutionary Computing', nameKo: '신경망/진화연산' },
    'cs.RO': { name: 'Robotics', nameKo: '로보틱스' },
    'stat.ML': { name: 'Machine Learning (Statistics)', nameKo: '통계적 머신러닝' }
};

// 사용자 역할 (요금제)
const USER_ROLES = {
    FREE: 'free',       // 무료 회원
    BASIC: 'basic',     // 베이직 회원 (₩9,900/월)
    PRO: 'pro',         // 프로 회원 (₩30,000/월)
    ADMIN: 'admin'      // 관리자
};

// 요금제 상세 정보
const PLAN_DETAILS = {
    free: {
        name: 'Free',
        nameKo: '무료',
        price: 0,
        features: {
            abstractTranslation: true,      // 초록 번역 무제한
            tldrSummary: true,              // 한줄 요약 무제한
            basicTranslation: 5,            // 기본 번역 (Haiku) 월 5편 (체험용)
            premiumTranslation: 2           // 고급 번역 (Sonnet) 월 2편 (체험용)
        }
    },
    basic: {
        name: 'Basic',
        nameKo: '베이직',
        price: 9900,
        features: {
            abstractTranslation: true,
            tldrSummary: true,
            basicTranslation: 30,           // 기본 번역 (Haiku) 월 30편
            premiumTranslation: 2           // 고급 번역 (Sonnet) 월 2편
        }
    },
    pro: {
        name: 'Pro',
        nameKo: '프로',
        price: 30000,
        features: {
            abstractTranslation: true,
            tldrSummary: true,
            basicTranslation: 100,          // 기본 번역 (Haiku) 월 100편
            premiumTranslation: 30          // 고급 번역 (Sonnet) 월 30편
        }
    },
    admin: {
        name: 'Admin',
        nameKo: '관리자',
        price: 0,
        features: {
            abstractTranslation: true,
            tldrSummary: true,
            basicTranslation: 999999,       // 무제한
            premiumTranslation: 999999      // 무제한
        }
    }
};

// 논문 처리 상태
const PROCESSING_STATUS = {
    PENDING: 'pending',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

// 쇼츠폼 상태
const SHORTS_STATUS = {
    DRAFT: 'draft',
    READY: 'ready',
    PUBLISHED: 'published',
    ARCHIVED: 'archived'
};

// 쇼츠폼 플랫폼
const SHORTS_PLATFORMS = {
    YOUTUBE: 'youtube',
    INSTAGRAM: 'instagram',
    TIKTOK: 'tiktok'
};

// 알림 유형
const NOTIFICATION_TYPES = {
    PAPER: 'paper',
    ANSWER: 'answer',
    MENTION: 'mention',
    SYSTEM: 'system'
};

// 투표 대상 유형
const VOTE_TARGET_TYPES = {
    QUESTION: 'question',
    ANSWER: 'answer'
};

// 투표 유형
const VOTE_TYPES = {
    UP: 'up',
    DOWN: 'down'
};

// 뉴스레터 빈도
const NEWSLETTER_FREQUENCY = {
    DAILY: 'daily',
    WEEKLY: 'weekly',
    MONTHLY: 'monthly'
};

// 작업 유형
const JOB_TYPES = {
    PAPER_COLLECT: 'paper_collect',
    AI_PROCESS: 'ai_process',
    NEWSLETTER: 'newsletter',
    SHORTS_SCORE: 'shorts_score'
};

// API 이름
const API_NAMES = {
    ARXIV: 'arxiv',
    OPENAI: 'openai',
    PWC: 'papers_with_code'
};

// 인용 형식
const CITATION_FORMATS = {
    BIBTEX: 'bibtex',
    APA: 'apa',
    MLA: 'mla',
    CHICAGO: 'chicago',
    IEEE: 'ieee'
};

// 정렬 옵션
const SORT_OPTIONS = {
    LATEST: 'published_date DESC',
    OLDEST: 'published_date ASC',
    MOST_VIEWED: 'view_count DESC',
    MOST_SAVED: 'save_count DESC',
    MOST_STARS: 'github_stars DESC',
    SHORTS_SCORE: 'shorts_score DESC'
};

// 페이지네이션 기본값
const PAGINATION = {
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 20,
    MAX_LIMIT: 100
};

// 번역 등급 (회원 유형별)
const TRANSLATION_TIER = {
    FREE: 'haiku',      // 무료 회원 - Claude 3.5 Haiku
    PREMIUM: 'sonnet'   // 유료 회원 - Claude Sonnet 4
};

// Claude 모델 설정 (번역/요약용)
const CLAUDE_MODELS = {
    haiku: 'claude-3-5-haiku-20241022',
    sonnet: 'claude-sonnet-4-20250514'
};

// AI 모델 설정 (임베딩용 - OpenAI)
const AI_MODELS = {
    EMBEDDING: 'text-embedding-3-small'
};

// 요약 길이 가이드라인
const SUMMARY_LENGTHS = {
    TLDR: { min: 30, max: 100 },
    THREE_LINE: { min: 100, max: 200 },
    DETAILED: { min: 400, max: 600 },
    BUSINESS: { min: 150, max: 250 },
    SHORTS_HOOK: { min: 20, max: 40 },
    SHORTS_MAIN: { min: 120, max: 180 },
    SHORTS_CTA: { min: 30, max: 50 }
};

// 쇼츠폼 추천 점수 가중치
const SHORTS_SCORE_WEIGHTS = {
    GITHUB_STARS: 0.30,
    TREND_KEYWORDS: 0.25,
    NOVELTY: 0.20,
    ACCESSIBILITY: 0.15,
    VISUAL_ASSETS: 0.10
};

// 트렌드 키워드 (쇼츠폼 점수 계산용)
const TREND_KEYWORDS = [
    'GPT', 'GPT-4', 'GPT-5', 'ChatGPT',
    'Claude', 'Gemini', 'LLaMA', 'Mistral',
    'Sora', 'DALL-E', 'Midjourney', 'Stable Diffusion',
    'RAG', 'Agent', 'Multimodal', 'Vision',
    'Reasoning', 'CoT', 'RLHF', 'DPO',
    'Mamba', 'SSM', 'Mixture of Experts', 'MoE',
    'Transformer', 'Attention', 'Tokenizer',
    'Open Source', 'Fine-tuning', 'PEFT', 'LoRA',
    'Benchmark', 'SOTA', 'State-of-the-Art'
];

// HTTP 상태 코드
const HTTP_STATUS = {
    OK: 200,
    CREATED: 201,
    NO_CONTENT: 204,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
};

// 에러 코드
const ERROR_CODES = {
    // 인증 관련
    AUTH_REQUIRED: 'AUTH_REQUIRED',
    INVALID_TOKEN: 'INVALID_TOKEN',
    TOKEN_EXPIRED: 'TOKEN_EXPIRED',
    INSUFFICIENT_PERMISSION: 'INSUFFICIENT_PERMISSION',

    // 검증 관련
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INVALID_INPUT: 'INVALID_INPUT',

    // 리소스 관련
    NOT_FOUND: 'NOT_FOUND',
    ALREADY_EXISTS: 'ALREADY_EXISTS',

    // 시스템 관련
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',

    // 제한 관련
    RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
    QUOTA_EXCEEDED: 'QUOTA_EXCEEDED'
};

module.exports = {
    PAPER_CATEGORIES,
    USER_ROLES,
    PLAN_DETAILS,
    PROCESSING_STATUS,
    SHORTS_STATUS,
    SHORTS_PLATFORMS,
    NOTIFICATION_TYPES,
    VOTE_TARGET_TYPES,
    VOTE_TYPES,
    NEWSLETTER_FREQUENCY,
    JOB_TYPES,
    API_NAMES,
    CITATION_FORMATS,
    SORT_OPTIONS,
    PAGINATION,
    AI_MODELS,
    TRANSLATION_TIER,
    CLAUDE_MODELS,
    SUMMARY_LENGTHS,
    SHORTS_SCORE_WEIGHTS,
    TREND_KEYWORDS,
    HTTP_STATUS,
    ERROR_CODES
};
