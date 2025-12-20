-- =============================================
-- KoKive Newsletter System Migration (FR-010)
-- 뉴스레터 및 알림 시스템 테이블
-- =============================================

-- 1. 뉴스레터 구독 테이블
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    email VARCHAR(255) NOT NULL,
    subscription_type ENUM('daily', 'weekly', 'monthly') DEFAULT 'weekly',
    categories JSON DEFAULT NULL COMMENT '구독 카테고리 (null = 전체)',
    is_verified BOOLEAN DEFAULT FALSE,
    verification_token VARCHAR(255) NULL,
    verification_expires_at DATETIME NULL,
    unsubscribe_token VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    verified_at DATETIME NULL,
    unsubscribed_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY idx_email (email),
    KEY idx_user_id (user_id),
    KEY idx_type_active (subscription_type, is_active, is_verified),
    KEY idx_verification_token (verification_token),
    KEY idx_unsubscribe_token (unsubscribe_token),

    CONSTRAINT fk_newsletter_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. 뉴스레터 발송 로그 테이블
CREATE TABLE IF NOT EXISTS newsletter_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    subscription_id INT NOT NULL,
    email VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NULL,
    newsletter_type ENUM('daily', 'weekly', 'monthly', 'special') NOT NULL,
    paper_count INT DEFAULT 0,
    status ENUM('sent', 'failed', 'bounced', 'opened', 'clicked') DEFAULT 'sent',
    sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    opened_at DATETIME NULL,
    clicked_at DATETIME NULL,
    error_message TEXT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    KEY idx_subscription_id (subscription_id),
    KEY idx_email (email),
    KEY idx_sent_at (sent_at),
    KEY idx_status (status),

    CONSTRAINT fk_newsletter_log_subscription FOREIGN KEY (subscription_id)
        REFERENCES newsletter_subscriptions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. 사용자 알림 설정 테이블
CREATE TABLE IF NOT EXISTS user_notification_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,

    -- 이메일 알림 설정
    email_new_papers BOOLEAN DEFAULT TRUE COMMENT '새 논문 알림',
    email_weekly_digest BOOLEAN DEFAULT TRUE COMMENT '주간 다이제스트',
    email_library_updates BOOLEAN DEFAULT TRUE COMMENT '라이브러리 업데이트',
    email_comments BOOLEAN DEFAULT TRUE COMMENT '댓글 알림',
    email_mentions BOOLEAN DEFAULT TRUE COMMENT '멘션 알림',

    -- 인앱 알림 설정
    push_new_papers BOOLEAN DEFAULT TRUE COMMENT '새 논문 푸시',
    push_comments BOOLEAN DEFAULT TRUE COMMENT '댓글 푸시',
    push_mentions BOOLEAN DEFAULT TRUE COMMENT '멘션 푸시',
    push_system BOOLEAN DEFAULT TRUE COMMENT '시스템 알림',

    -- 알림 빈도 설정
    notification_frequency ENUM('realtime', 'hourly', 'daily') DEFAULT 'realtime',
    quiet_hours_start TIME NULL COMMENT '방해금지 시작 시간',
    quiet_hours_end TIME NULL COMMENT '방해금지 종료 시간',

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY idx_user_id (user_id),

    CONSTRAINT fk_notification_settings_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. 인앱 알림 테이블
CREATE TABLE IF NOT EXISTS user_notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('new_paper', 'comment', 'mention', 'library', 'system', 'newsletter') NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NULL,
    link VARCHAR(500) NULL COMMENT '클릭시 이동할 링크',
    reference_type VARCHAR(50) NULL COMMENT '관련 엔티티 타입 (paper, comment 등)',
    reference_id INT NULL COMMENT '관련 엔티티 ID',
    is_read BOOLEAN DEFAULT FALSE,
    read_at DATETIME NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    KEY idx_user_id (user_id),
    KEY idx_user_unread (user_id, is_read),
    KEY idx_type (type),
    KEY idx_created_at (created_at),
    KEY idx_reference (reference_type, reference_id),

    CONSTRAINT fk_user_notification_user FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =============================================
-- 인덱스 최적화
-- =============================================

-- 구독자 조회용 복합 인덱스
CREATE INDEX idx_newsletter_active_subscribers
    ON newsletter_subscriptions(subscription_type, is_active, is_verified, verified_at);

-- 알림 목록 조회용 복합 인덱스
CREATE INDEX idx_notifications_list
    ON user_notifications(user_id, is_read, created_at DESC);

-- =============================================
-- 초기 데이터 (선택사항)
-- =============================================

-- 기존 사용자에게 기본 알림 설정 생성
INSERT IGNORE INTO user_notification_settings (user_id)
SELECT id FROM users WHERE id NOT IN (
    SELECT user_id FROM user_notification_settings
);
