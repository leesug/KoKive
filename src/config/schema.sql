-- ================================================
-- KoKive v3.0 Database Schema
-- AI/ML 논문 번역/요약 플랫폼
-- ================================================

-- 데이터베이스 선택 (이미 존재하면 사용)
-- CREATE DATABASE IF NOT EXISTS kokive CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE kokive;

-- ================================================
-- 1. 사용자 관련 테이블
-- ================================================

-- 사용자 테이블
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(50) NOT NULL,
    role ENUM('free', 'pro', 'admin') DEFAULT 'free',
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    profile_image_url VARCHAR(500),
    preferences JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    last_login_at TIMESTAMP NULL,
    INDEX idx_email (email),
    INDEX idx_role (role),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 리프레시 토큰 테이블
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token VARCHAR(500) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token(255)),
    INDEX idx_user_id (user_id),
    INDEX idx_expires_at (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 2. 논문 관련 테이블
-- ================================================

-- 논문 메인 테이블
CREATE TABLE IF NOT EXISTS papers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    arxiv_id VARCHAR(50) NOT NULL UNIQUE,
    title_en TEXT NOT NULL,
    title_ko TEXT,
    abstract_en TEXT,
    abstract_ko TEXT,
    authors JSON,
    primary_category VARCHAR(20),
    categories JSON,
    published_at DATE,
    updated_at_arxiv TIMESTAMP NULL,
    pdf_url VARCHAR(500),
    arxiv_url VARCHAR(500),
    doi VARCHAR(100),
    journal_ref VARCHAR(255),
    comment TEXT,
    processing_status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
    processing_error TEXT,
    tokens_used INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_arxiv_id (arxiv_id),
    INDEX idx_primary_category (primary_category),
    INDEX idx_published_at (published_at),
    INDEX idx_processing_status (processing_status),
    INDEX idx_created_at (created_at),
    FULLTEXT idx_title_en (title_en),
    FULLTEXT idx_title_ko (title_ko),
    FULLTEXT idx_abstract_en (abstract_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 논문 요약 테이블
CREATE TABLE IF NOT EXISTS paper_summaries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL UNIQUE,
    tldr VARCHAR(200),
    summary_3line TEXT,
    summary_detailed TEXT,
    business_insight TEXT,
    shorts_script JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 논문 번역 테이블 (섹션별)
CREATE TABLE IF NOT EXISTS paper_translations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    section_type ENUM('title', 'abstract', 'introduction', 'methodology', 'results', 'conclusion') NOT NULL,
    original_text TEXT,
    translated_text TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    UNIQUE KEY unique_paper_section (paper_id, section_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 논문 임베딩 테이블 (시맨틱 검색용)
CREATE TABLE IF NOT EXISTS paper_embeddings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL UNIQUE,
    embedding_model VARCHAR(50) DEFAULT 'text-embedding-3-small',
    embedding_vector BLOB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 3. 용어 사전 테이블
-- ================================================

-- 용어 테이블
CREATE TABLE IF NOT EXISTS terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    term_en VARCHAR(200) NOT NULL UNIQUE,
    term_ko VARCHAR(200),
    definition_ko TEXT,
    category VARCHAR(50) DEFAULT 'general',
    related_terms JSON,
    example_sentence TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_term_en (term_en),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 논문-용어 연결 테이블
CREATE TABLE IF NOT EXISTS paper_terms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    term_id INT NOT NULL,
    frequency INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE,
    UNIQUE KEY unique_paper_term (paper_id, term_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 4. 코드 연동 테이블
-- ================================================

-- 논문-GitHub 코드 연결 테이블
CREATE TABLE IF NOT EXISTS paper_code_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    repo_url VARCHAR(500) NOT NULL,
    repo_name VARCHAR(200),
    repo_owner VARCHAR(100),
    stars INT DEFAULT 0,
    forks INT DEFAULT 0,
    language VARCHAR(50),
    description TEXT,
    is_official BOOLEAN DEFAULT FALSE,
    framework VARCHAR(50),
    last_updated_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    INDEX idx_paper_id (paper_id),
    INDEX idx_stars (stars)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 5. Q&A 커뮤니티 테이블
-- ================================================

-- 질문 테이블
CREATE TABLE IF NOT EXISTS questions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    user_id INT NOT NULL,
    title VARCHAR(300) NOT NULL,
    content TEXT NOT NULL,
    tags JSON,
    view_count INT DEFAULT 0,
    is_answered BOOLEAN DEFAULT FALSE,
    is_pinned BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_paper_id (paper_id),
    INDEX idx_user_id (user_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 답변 테이블
CREATE TABLE IF NOT EXISTS answers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    question_id INT NOT NULL,
    user_id INT NOT NULL,
    content TEXT NOT NULL,
    is_accepted BOOLEAN DEFAULT FALSE,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_question_id (question_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 투표 테이블
CREATE TABLE IF NOT EXISTS votes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    target_type ENUM('question', 'answer') NOT NULL,
    target_id INT NOT NULL,
    value TINYINT NOT NULL CHECK (value IN (-1, 1)),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_vote (user_id, target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 6. 사용자 라이브러리 테이블
-- ================================================

-- 사용자 라이브러리 (북마크/저장)
CREATE TABLE IF NOT EXISTS user_libraries (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    paper_id INT NOT NULL,
    folder_name VARCHAR(100) DEFAULT 'default',
    notes TEXT,
    tags JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_paper (user_id, paper_id),
    INDEX idx_user_id (user_id),
    INDEX idx_folder_name (folder_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 논문 평점 테이블
CREATE TABLE IF NOT EXISTS paper_ratings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    user_id INT NOT NULL,
    rating TINYINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_paper_user_rating (paper_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 열람 기록 테이블
CREATE TABLE IF NOT EXISTS reading_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    paper_id INT NOT NULL,
    read_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    read_duration_seconds INT DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_read_at (read_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 7. 알림 테이블
-- ================================================

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('new_paper', 'answer', 'mention', 'system') NOT NULL,
    title VARCHAR(200) NOT NULL,
    message TEXT,
    link VARCHAR(500),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_user_id (user_id),
    INDEX idx_is_read (is_read),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 8. 쇼츠폼 관련 테이블
-- ================================================

-- 쇼츠폼 메인 테이블
CREATE TABLE IF NOT EXISTS shorts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    title VARCHAR(200),
    script_hook TEXT,
    script_main TEXT,
    script_cta TEXT,
    thumbnail_url VARCHAR(500),
    thumbnail_text VARCHAR(50),
    status ENUM('draft', 'ready', 'published', 'archived') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (paper_id) REFERENCES papers(id) ON DELETE CASCADE,
    INDEX idx_paper_id (paper_id),
    INDEX idx_status (status),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 쇼츠폼 플랫폼 업로드 정보
CREATE TABLE IF NOT EXISTS shorts_platforms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shorts_id INT NOT NULL,
    platform ENUM('youtube', 'tiktok', 'instagram', 'x') NOT NULL,
    video_url VARCHAR(500),
    tracking_url VARCHAR(500),
    published_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shorts_id) REFERENCES shorts(id) ON DELETE CASCADE,
    UNIQUE KEY unique_shorts_platform (shorts_id, platform)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 쇼츠폼 성과 통계
CREATE TABLE IF NOT EXISTS shorts_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    shorts_platform_id INT NOT NULL,
    date DATE NOT NULL,
    views INT DEFAULT 0,
    clicks INT DEFAULT 0,
    likes INT DEFAULT 0,
    comments INT DEFAULT 0,
    shares INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (shorts_platform_id) REFERENCES shorts_platforms(id) ON DELETE CASCADE,
    UNIQUE KEY unique_platform_date (shorts_platform_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 9. 시스템 테이블
-- ================================================

-- 작업 큐 테이블
CREATE TABLE IF NOT EXISTS job_queue (
    id INT AUTO_INCREMENT PRIMARY KEY,
    job_type ENUM('paper_collect', 'ai_process', 'embedding', 'notification') NOT NULL,
    payload JSON,
    status ENUM('pending', 'processing', 'completed', 'failed', 'cancelled') DEFAULT 'pending',
    priority INT DEFAULT 5,
    attempts INT DEFAULT 0,
    max_attempts INT DEFAULT 3,
    error_message TEXT,
    scheduled_at TIMESTAMP NULL,
    started_at TIMESTAMP NULL,
    completed_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_status (status),
    INDEX idx_job_type (job_type),
    INDEX idx_priority (priority),
    INDEX idx_scheduled_at (scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- API 사용량 로그
CREATE TABLE IF NOT EXISTS api_usage_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    service_name VARCHAR(50) NOT NULL,
    tokens_used INT DEFAULT 0,
    response_time_ms INT DEFAULT 0,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_service_name (service_name),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 시스템 설정 테이블
CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    description VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================
-- 초기 데이터 삽입
-- ================================================

-- 기본 시스템 설정
INSERT IGNORE INTO system_settings (setting_key, setting_value, description) VALUES
('paper_collect_enabled', 'true', '논문 자동 수집 활성화 여부'),
('paper_collect_categories', '["cs.AI", "cs.LG", "cs.CL", "cs.CV", "cs.NE"]', '수집 대상 카테고리'),
('papers_per_category', '20', '카테고리당 수집 논문 수'),
('ai_processing_enabled', 'true', 'AI 처리 활성화 여부'),
('openai_model', 'gpt-4o-mini', '사용할 OpenAI 모델'),
('max_tokens_per_paper', '10000', '논문당 최대 토큰 사용량');

-- 기본 용어 데이터
INSERT IGNORE INTO terms (term_en, term_ko, definition_ko, category) VALUES
('Transformer', '트랜스포머', '어텐션 메커니즘을 기반으로 한 신경망 아키텍처로, 순차적 처리 없이 병렬 처리가 가능하여 NLP 분야에서 혁신적인 성능을 보여줌', 'architecture'),
('Attention Mechanism', '어텐션 메커니즘', '입력 시퀀스의 각 요소가 출력에 미치는 중요도를 동적으로 계산하는 기법', 'technique'),
('Large Language Model', '대규모 언어 모델', '방대한 텍스트 데이터로 학습된 언어 모델로, GPT, BERT 등이 대표적', 'model'),
('Fine-tuning', '파인튜닝', '사전 학습된 모델을 특정 태스크에 맞게 추가 학습시키는 과정', 'technique'),
('Embedding', '임베딩', '텍스트, 이미지 등을 고정 차원의 벡터로 변환하는 기법', 'technique'),
('Prompt Engineering', '프롬프트 엔지니어링', 'AI 모델에서 원하는 출력을 얻기 위해 입력 프롬프트를 설계하는 기술', 'technique'),
('Reinforcement Learning', '강화학습', '환경과의 상호작용을 통해 보상을 최대화하는 정책을 학습하는 기계학습 패러다임', 'paradigm'),
('Diffusion Model', '확산 모델', '노이즈를 점진적으로 제거하여 데이터를 생성하는 생성 모델', 'model'),
('Neural Network', '신경망', '생물학적 뉴런을 모방한 인공 뉴런들의 연결 구조', 'architecture'),
('Backpropagation', '역전파', '신경망에서 오차를 역방향으로 전파하여 가중치를 업데이트하는 학습 알고리즘', 'algorithm');

-- 테스트 관리자 계정 (비밀번호: admin123 - bcrypt 해시)
INSERT IGNORE INTO users (email, password_hash, nickname, role) VALUES
('admin@kokive.com', '$2b$10$rQZ8K.HvhkGR7e6P4C8zKuXGzJxMbJqXE6U9Z8xKvL2mN3oP4qR6S', 'Admin', 'admin');

-- ================================================
-- 완료 메시지
-- ================================================
SELECT 'KoKive v3.0 스키마 생성 완료!' AS message;
SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = 'kokive';
