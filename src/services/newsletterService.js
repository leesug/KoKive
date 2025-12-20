/**
 * KoKive Newsletter Service
 * 뉴스레터 구독 및 발송 (FR-010)
 */

const { query, queryOne, insert, update, remove } = require('../config/database');
const crypto = require('crypto');
const { sendNewsletterEmail, sendNewsletterVerificationEmail } = require('./emailService');

class NewsletterService {
    /**
     * 뉴스레터 구독
     */
    async subscribe(email, options = {}) {
        const {
            userId = null,
            subscriptionType = 'weekly',
            categories = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV']
        } = options;

        // 이미 구독 중인지 확인
        const existing = await queryOne(
            'SELECT id, is_active FROM newsletter_subscriptions WHERE email = ?',
            [email]
        );

        const verificationToken = crypto.randomBytes(32).toString('hex');

        if (existing) {
            if (existing.is_active) {
                return { success: false, message: '이미 구독 중입니다.' };
            }

            // 재구독
            await update('newsletter_subscriptions', {
                user_id: userId,
                subscription_type: subscriptionType,
                categories: JSON.stringify(categories),
                is_active: true,
                verification_token: verificationToken,
                verified_at: null,
                unsubscribed_at: null
            }, 'id = ?', [existing.id]);

            return {
                success: true,
                message: '재구독되었습니다. 이메일을 확인해주세요.',
                verificationToken
            };
        }

        // 신규 구독
        const subscriptionId = await insert('newsletter_subscriptions', {
            user_id: userId,
            email,
            subscription_type: subscriptionType,
            categories: JSON.stringify(categories),
            verification_token: verificationToken
        });

        return {
            success: true,
            message: '구독 신청되었습니다. 이메일을 확인해주세요.',
            subscriptionId,
            verificationToken
        };
    }

    /**
     * 이메일 인증
     */
    async verifyEmail(token) {
        const subscription = await queryOne(
            'SELECT id FROM newsletter_subscriptions WHERE verification_token = ? AND verified_at IS NULL',
            [token]
        );

        if (!subscription) {
            return { success: false, message: '유효하지 않은 인증 토큰입니다.' };
        }

        await update('newsletter_subscriptions', {
            verified_at: new Date(),
            verification_token: null
        }, 'id = ?', [subscription.id]);

        return { success: true, message: '이메일이 인증되었습니다.' };
    }

    /**
     * 구독 해지
     */
    async unsubscribe(email, token = null) {
        let condition = 'email = ?';
        const params = [email];

        if (token) {
            condition += ' AND verification_token = ?';
            params.push(token);
        }

        const subscription = await queryOne(
            `SELECT id FROM newsletter_subscriptions WHERE ${condition}`,
            params
        );

        if (!subscription) {
            return { success: false, message: '구독 정보를 찾을 수 없습니다.' };
        }

        await update('newsletter_subscriptions', {
            is_active: false,
            unsubscribed_at: new Date()
        }, 'id = ?', [subscription.id]);

        return { success: true, message: '구독이 해지되었습니다.' };
    }

    /**
     * 구독 설정 변경
     */
    async updateSettings(email, settings) {
        const { subscriptionType, categories } = settings;

        const updateData = {};
        if (subscriptionType) updateData.subscription_type = subscriptionType;
        if (categories) updateData.categories = JSON.stringify(categories);

        await update('newsletter_subscriptions', updateData, 'email = ?', [email]);

        return { success: true, message: '설정이 변경되었습니다.' };
    }

    /**
     * 구독 정보 조회
     */
    async getSubscription(email) {
        const subscription = await queryOne(
            `SELECT
                id,
                email,
                subscription_type,
                categories,
                is_active,
                verified_at,
                created_at
            FROM newsletter_subscriptions
            WHERE email = ?`,
            [email]
        );

        if (!subscription) {
            return null;
        }

        return {
            id: subscription.id,
            email: subscription.email,
            subscriptionType: subscription.subscription_type,
            categories: subscription.categories ? JSON.parse(subscription.categories) : [],
            isActive: subscription.is_active,
            verifiedAt: subscription.verified_at,
            createdAt: subscription.created_at
        };
    }

    /**
     * 사용자 알림 설정 조회
     */
    async getNotificationSettings(userId) {
        const settings = await queryOne(
            'SELECT * FROM user_notification_settings WHERE user_id = ?',
            [userId]
        );

        if (!settings) {
            // 기본 설정 생성
            await insert('user_notification_settings', { user_id: userId });
            return this.getNotificationSettings(userId);
        }

        return {
            emailNewPaper: settings.email_new_paper,
            emailAnswerReceived: settings.email_answer_received,
            emailWeeklyDigest: settings.email_weekly_digest,
            pushEnabled: settings.push_enabled,
            quietHoursStart: settings.quiet_hours_start,
            quietHoursEnd: settings.quiet_hours_end,
            preferredCategories: settings.preferred_categories
                ? JSON.parse(settings.preferred_categories)
                : []
        };
    }

    /**
     * 사용자 알림 설정 변경
     */
    async updateNotificationSettings(userId, settings) {
        const updateData = {};

        if (settings.emailNewPaper !== undefined) {
            updateData.email_new_paper = settings.emailNewPaper;
        }
        if (settings.emailAnswerReceived !== undefined) {
            updateData.email_answer_received = settings.emailAnswerReceived;
        }
        if (settings.emailWeeklyDigest !== undefined) {
            updateData.email_weekly_digest = settings.emailWeeklyDigest;
        }
        if (settings.pushEnabled !== undefined) {
            updateData.push_enabled = settings.pushEnabled;
        }
        if (settings.quietHoursStart !== undefined) {
            updateData.quiet_hours_start = settings.quietHoursStart;
        }
        if (settings.quietHoursEnd !== undefined) {
            updateData.quiet_hours_end = settings.quietHoursEnd;
        }
        if (settings.preferredCategories !== undefined) {
            updateData.preferred_categories = JSON.stringify(settings.preferredCategories);
        }

        const existing = await queryOne(
            'SELECT id FROM user_notification_settings WHERE user_id = ?',
            [userId]
        );

        if (existing) {
            await update('user_notification_settings', updateData, 'user_id = ?', [userId]);
        } else {
            await insert('user_notification_settings', {
                user_id: userId,
                ...updateData
            });
        }

        return { success: true, message: '알림 설정이 변경되었습니다.' };
    }

    /**
     * 인앱 알림 생성
     */
    async createNotification(userId, notification) {
        const { type, title, message, link } = notification;

        const notificationId = await insert('notifications', {
            user_id: userId,
            type,
            title,
            message,
            link
        });

        return notificationId;
    }

    /**
     * 사용자 알림 목록 조회
     */
    async getNotifications(userId, options = {}) {
        const { page = 1, limit = 20, unreadOnly = false } = options;
        const offset = (page - 1) * limit;

        let whereClause = 'user_id = ?';
        const params = [userId];

        if (unreadOnly) {
            whereClause += ' AND is_read = FALSE';
        }

        const notifications = await query(
            `SELECT id, type, title, message, link, is_read, created_at
            FROM notifications
            WHERE ${whereClause}
            ORDER BY created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        const totalResult = await queryOne(
            `SELECT COUNT(*) as count FROM notifications WHERE ${whereClause}`,
            params
        );

        const unreadResult = await queryOne(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );

        return {
            items: notifications.map(n => ({
                id: n.id,
                type: n.type,
                title: n.title,
                message: n.message,
                link: n.link,
                isRead: n.is_read,
                createdAt: n.created_at
            })),
            pagination: {
                page,
                limit,
                total: totalResult?.count || 0,
                totalPages: Math.ceil((totalResult?.count || 0) / limit)
            },
            unreadCount: unreadResult?.count || 0
        };
    }

    /**
     * 알림 읽음 처리
     */
    async markAsRead(userId, notificationId) {
        await update('notifications', { is_read: true }, 'id = ? AND user_id = ?', [notificationId, userId]);
        return { success: true };
    }

    /**
     * 모든 알림 읽음 처리
     */
    async markAllAsRead(userId) {
        await query(
            'UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND is_read = FALSE',
            [userId]
        );
        return { success: true };
    }

    /**
     * 알림 삭제
     */
    async deleteNotification(userId, notificationId) {
        await remove('notifications', 'id = ? AND user_id = ?', [notificationId, userId]);
        return { success: true };
    }

    /**
     * 구독자 목록 조회 (발송용)
     */
    async getActiveSubscribers(type = 'weekly') {
        return query(
            `SELECT email, categories, user_id
            FROM newsletter_subscriptions
            WHERE is_active = TRUE
              AND verified_at IS NOT NULL
              AND subscription_type = ?`,
            [type]
        );
    }

    /**
     * 뉴스레터 발송 로그 저장
     */
    async logNewsletterSend(newsletterType, subject, contentHtml, sentCount) {
        return insert('newsletter_logs', {
            newsletter_type: newsletterType,
            subject,
            content_html: contentHtml,
            sent_count: sentCount,
            sent_at: new Date()
        });
    }

    /**
     * 특정 카테고리의 최신 논문 조회 (뉴스레터 발송용)
     */
    async getRecentPapersByCategories(categories, daysAgo = 7, limit = 10) {
        if (!categories || categories.length === 0) {
            categories = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV'];
        }

        const placeholders = categories.map(() => '?').join(',');

        const papers = await query(
            `SELECT
                p.id,
                p.arxiv_id,
                p.title,
                p.title_ko,
                p.authors,
                p.category,
                p.summary_ko,
                p.published_date,
                p.created_at
            FROM papers p
            WHERE p.category IN (${placeholders})
              AND p.processing_status = 'completed'
              AND p.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
            ORDER BY p.created_at DESC
            LIMIT ?`,
            [...categories, daysAgo, limit]
        );

        return papers;
    }

    /**
     * 주간 뉴스레터 발송
     */
    async sendWeeklyNewsletter() {
        const subscribers = await this.getActiveSubscribers('weekly');

        if (subscribers.length === 0) {
            console.log('No active weekly subscribers');
            return { success: true, sentCount: 0 };
        }

        let sentCount = 0;
        const errors = [];

        for (const subscriber of subscribers) {
            try {
                // 구독자의 관심 카테고리 파싱
                let categories = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV'];
                if (subscriber.categories) {
                    try {
                        categories = JSON.parse(subscriber.categories);
                    } catch (e) {
                        // 파싱 실패 시 기본 카테고리 사용
                    }
                }

                // 해당 카테고리의 최신 논문 조회
                const papers = await this.getRecentPapersByCategories(categories, 7, 10);

                if (papers.length === 0) {
                    continue; // 새 논문이 없으면 발송하지 않음
                }

                // 구독 해지용 토큰 생성
                const unsubscribeToken = crypto.randomBytes(32).toString('hex');
                await update('newsletter_subscriptions',
                    { verification_token: unsubscribeToken },
                    'email = ?',
                    [subscriber.email]
                );

                // 이메일 발송
                const subject = '[KoKive] 이번 주 AI 논문 다이제스트';
                await sendNewsletterEmail(subscriber.email, subject, papers, unsubscribeToken);

                sentCount++;
            } catch (error) {
                console.error(`Failed to send to ${subscriber.email}:`, error.message);
                errors.push({ email: subscriber.email, error: error.message });
            }
        }

        // 발송 로그 저장
        await this.logNewsletterSend('weekly', '[KoKive] 이번 주 AI 논문 다이제스트', '', sentCount);

        return {
            success: true,
            sentCount,
            totalSubscribers: subscribers.length,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 일간 뉴스레터 발송
     */
    async sendDailyNewsletter() {
        const subscribers = await this.getActiveSubscribers('daily');

        if (subscribers.length === 0) {
            console.log('No active daily subscribers');
            return { success: true, sentCount: 0 };
        }

        let sentCount = 0;
        const errors = [];

        for (const subscriber of subscribers) {
            try {
                // 구독자의 관심 카테고리 파싱
                let categories = ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV'];
                if (subscriber.categories) {
                    try {
                        categories = JSON.parse(subscriber.categories);
                    } catch (e) {
                        // 파싱 실패 시 기본 카테고리 사용
                    }
                }

                // 해당 카테고리의 최신 논문 조회 (1일)
                const papers = await this.getRecentPapersByCategories(categories, 1, 5);

                if (papers.length === 0) {
                    continue; // 새 논문이 없으면 발송하지 않음
                }

                // 구독 해지용 토큰 생성
                const unsubscribeToken = crypto.randomBytes(32).toString('hex');
                await update('newsletter_subscriptions',
                    { verification_token: unsubscribeToken },
                    'email = ?',
                    [subscriber.email]
                );

                // 이메일 발송
                const subject = '[KoKive] 오늘의 새로운 논문';
                await sendNewsletterEmail(subscriber.email, subject, papers, unsubscribeToken);

                sentCount++;
            } catch (error) {
                console.error(`Failed to send to ${subscriber.email}:`, error.message);
                errors.push({ email: subscriber.email, error: error.message });
            }
        }

        // 발송 로그 저장
        await this.logNewsletterSend('daily', '[KoKive] 오늘의 새로운 논문', '', sentCount);

        return {
            success: true,
            sentCount,
            totalSubscribers: subscribers.length,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * 특정 구독자에게 개인화된 뉴스레터 발송 (관리자용)
     */
    async sendPersonalizedNewsletter(email, options = {}) {
        const {
            subject = '[KoKive] 추천 논문',
            daysAgo = 7,
            limit = 10
        } = options;

        const subscription = await this.getSubscription(email);

        if (!subscription || !subscription.isActive) {
            return { success: false, message: '활성 구독 정보가 없습니다.' };
        }

        const categories = subscription.categories.length > 0
            ? subscription.categories
            : ['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV'];

        const papers = await this.getRecentPapersByCategories(categories, daysAgo, limit);

        if (papers.length === 0) {
            return { success: false, message: '발송할 논문이 없습니다.' };
        }

        // 구독 해지용 토큰 생성
        const unsubscribeToken = crypto.randomBytes(32).toString('hex');
        await update('newsletter_subscriptions',
            { verification_token: unsubscribeToken },
            'email = ?',
            [email]
        );

        await sendNewsletterEmail(email, subject, papers, unsubscribeToken);

        return {
            success: true,
            message: '뉴스레터가 발송되었습니다.',
            paperCount: papers.length
        };
    }

    /**
     * 뉴스레터 통계 조회
     */
    async getNewsletterStats() {
        const totalSubscribers = await queryOne(
            'SELECT COUNT(*) as count FROM newsletter_subscriptions WHERE is_active = TRUE AND verified_at IS NOT NULL'
        );

        const byType = await query(
            `SELECT subscription_type, COUNT(*) as count
            FROM newsletter_subscriptions
            WHERE is_active = TRUE AND verified_at IS NOT NULL
            GROUP BY subscription_type`
        );

        const recentLogs = await query(
            `SELECT newsletter_type, subject, sent_count, open_count, click_count, sent_at
            FROM newsletter_logs
            ORDER BY sent_at DESC
            LIMIT 10`
        );

        return {
            totalSubscribers: totalSubscribers?.count || 0,
            byType: byType.reduce((acc, item) => {
                acc[item.subscription_type] = item.count;
                return acc;
            }, {}),
            recentLogs: recentLogs.map(log => ({
                type: log.newsletter_type,
                subject: log.subject,
                sentCount: log.sent_count,
                openCount: log.open_count,
                clickCount: log.click_count,
                sentAt: log.sent_at
            }))
        };
    }
}

module.exports = new NewsletterService();
