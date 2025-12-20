-- =============================================
-- KoKive Paper Translations Migration
-- 섹션별 번역에서 전체 번역으로 변경
-- =============================================

-- 외래 키 검사 비활성화
SET FOREIGN_KEY_CHECKS = 0;

-- 1. 기존 테이블 백업 (데이터가 있을 경우)
CREATE TABLE IF NOT EXISTS paper_translations_backup_v2 AS
SELECT * FROM paper_translations;

-- 2. 기존 테이블 삭제 (FOREIGN_KEY_CHECKS = 0이므로 가능)
DROP TABLE IF EXISTS paper_translations;

-- 3. 새 테이블 생성 (전체 논문 번역, translation_tier 기반)
CREATE TABLE paper_translations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paper_id INT NOT NULL,
    translation_tier ENUM('haiku', 'sonnet') NOT NULL DEFAULT 'haiku' COMMENT '번역 모델 (haiku=기본, sonnet=고급)',
    original_text LONGTEXT COMMENT '원문 텍스트',
    translated_text LONGTEXT COMMENT '번역된 텍스트',
    section_count INT DEFAULT 0 COMMENT '섹션 수',
    word_count INT DEFAULT 0 COMMENT '단어 수',
    token_count INT DEFAULT 0 COMMENT '토큰 사용량',
    cost_usd DECIMAL(10, 6) DEFAULT 0 COMMENT 'API 비용 (USD)',
    status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending' COMMENT '번역 상태',
    error_message TEXT NULL COMMENT '오류 메시지',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- 같은 논문에 대해 tier별로 하나씩만 허용
    UNIQUE KEY unique_paper_tier (paper_id, translation_tier),

    -- 인덱스
    KEY idx_paper_id (paper_id),
    KEY idx_tier (translation_tier),
    KEY idx_status (status),
    KEY idx_created_at (created_at),

    -- 외래키
    CONSTRAINT fk_paper_translation_paper FOREIGN KEY (paper_id)
        REFERENCES papers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 외래 키 검사 활성화
SET FOREIGN_KEY_CHECKS = 1;

-- =============================================
-- 확인용 쿼리 (실행 후 확인)
-- =============================================
-- SHOW CREATE TABLE paper_translations;
-- DESCRIBE paper_translations;
