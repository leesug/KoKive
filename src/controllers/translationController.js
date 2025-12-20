/**
 * KoKive Translation Controller
 * PDF 본문 번역 API (On-demand 방식)
 */

const { query, queryOne, insert, update } = require('../config/database');
const { PLAN_DETAILS } = require('../config/constants');
const pdfService = require('../services/pdfService');

// 요금제별 월간 번역 한도 (constants.js의 PLAN_DETAILS에서 생성)
const PLAN_LIMITS = Object.fromEntries(
    Object.entries(PLAN_DETAILS).map(([role, plan]) => [
        role,
        {
            basic: plan.features.basicTranslation,
            premium: plan.features.premiumTranslation
        }
    ])
);
// 결과: free: { basic: 5, premium: 2 }, basic: { basic: 30, premium: 0 }, pro: { basic: 100, premium: 30 }, admin: { basic: 999999, premium: 999999 }

/**
 * 사용자의 월간 번역 사용량 조회
 */
async function getUserUsage(userId) {
    const periodMonth = new Date().toISOString().slice(0, 7); // '2024-12' 형식

    let usage = await queryOne(
        'SELECT * FROM user_translation_usage WHERE user_id = ? AND period_month = ?',
        [userId, periodMonth]
    );

    if (!usage) {
        // 해당 월 레코드가 없으면 생성
        await insert('user_translation_usage', {
            user_id: userId,
            period_month: periodMonth,
            basic_count: 0,
            premium_count: 0
        });
        usage = { user_id: userId, period_month: periodMonth, basic_count: 0, premium_count: 0 };
    }

    // 기존 usage_count 컬럼 호환성 (마이그레이션 전)
    if (usage.usage_count !== undefined && usage.basic_count === undefined) {
        usage.basic_count = usage.usage_count;
        usage.premium_count = 0;
    }

    return usage;
}

/**
 * 번역 사용량 증가
 * @param {number} userId - 사용자 ID
 * @param {string} tier - 'basic' 또는 'premium'
 */
async function incrementUsage(userId, tier = 'basic') {
    const periodMonth = new Date().toISOString().slice(0, 7);
    const countColumn = tier === 'premium' ? 'premium_count' : 'basic_count';

    await query(
        `INSERT INTO user_translation_usage (user_id, period_month, ${countColumn})
         VALUES (?, ?, 1)
         ON DUPLICATE KEY UPDATE ${countColumn} = ${countColumn} + 1, updated_at = NOW()`,
        [userId, periodMonth]
    );
}

/**
 * 번역본 요청 (On-demand)
 * POST /api/v1/papers/:id/translation
 * Body: { tier: 'basic' | 'advanced' }
 * - basic: Haiku 모델 (Basic, Pro, Admin)
 * - advanced: Sonnet 모델 (Pro, Admin만 가능)
 */
exports.requestTranslation = async (req, res) => {
    try {
        const paperId = parseInt(req.params.id);
        const userId = req.user.id;
        const userRole = req.user.role;
        const requestedTier = req.body.tier || 'basic'; // 기본은 basic (Haiku)

        // 티어 매핑: basic -> haiku, advanced -> sonnet
        const modelMap = {
            basic: 'haiku',
            advanced: 'sonnet'
        };
        const model = modelMap[requestedTier] || 'haiku';
        const usageTier = requestedTier === 'advanced' ? 'premium' : 'basic';

        // 1. 사용자 요금제 확인
        const planLimits = PLAN_LIMITS[userRole] || { basic: 0, premium: 0 };

        // 기본 번역 한도 체크 (무료회원도 5편 제공)
        if (requestedTier === 'basic' && planLimits.basic === 0) {
            return res.status(403).json({
                success: false,
                error: '본문 번역 기능을 이용할 수 없습니다.',
                upgrade: true
            });
        }

        // 2. 고급 번역 한도 체크 (무료회원 2편, Basic 0편, Pro 30편)
        if (requestedTier === 'advanced' && planLimits.premium === 0) {
            return res.status(403).json({
                success: false,
                error: '고급 번역(Sonnet)은 무료 체험 또는 Pro 회원만 이용 가능합니다.',
                upgrade: true
            });
        }

        // 3. 월간 사용량 확인
        const usage = await getUserUsage(userId);
        const currentUsage = usageTier === 'premium' ? (usage.premium_count || 0) : (usage.basic_count || 0);
        const currentLimit = usageTier === 'premium' ? planLimits.premium : planLimits.basic;

        if (currentUsage >= currentLimit) {
            const tierName = usageTier === 'premium' ? '고급 번역' : '기본 번역';
            return res.status(403).json({
                success: false,
                error: `이번 달 ${tierName} 한도(${currentLimit}편)를 모두 사용했습니다.`,
                usage: {
                    basicUsed: usage.basic_count || 0,
                    basicLimit: planLimits.basic,
                    premiumUsed: usage.premium_count || 0,
                    premiumLimit: planLimits.premium
                },
                upgrade: userRole !== 'pro' && userRole !== 'admin'
            });
        }

        // 4. 논문 정보 조회
        const paper = await queryOne(
            'SELECT id, arxiv_id, title_en, title_ko, abstract_ko FROM papers WHERE id = ?',
            [paperId]
        );

        if (!paper) {
            return res.status(404).json({ success: false, error: '논문을 찾을 수 없습니다.' });
        }

        // 5. 고급 번역인 경우 기존 AI 분석 결과 조회 (맥락 주입용)
        let paperContext = null;
        if (requestedTier === 'advanced') {
            const summary = await queryOne(
                `SELECT summary_3line, summary_detailed, business_insight
                 FROM paper_summaries WHERE paper_id = ?`,
                [paperId]
            );
            if (summary) {
                paperContext = {
                    summary_3line: summary.summary_3line || '',
                    summary_detailed: summary.summary_detailed || '',
                    business_insight: summary.business_insight || '',
                    abstract_ko: paper.abstract_ko || ''
                };
                console.log(`📚 논문 ${paperId} 맥락 정보 로드 완료`);
            }
        }

        // 6. 해당 티어의 기존 번역본 확인 (캐시 또는 실패/처리중)
        let translation = await queryOne(
            'SELECT * FROM paper_translations WHERE paper_id = ? AND translation_tier = ?',
            [paperId, model]
        );

        if (translation && translation.status === 'completed') {
            // 캐시된 번역본 반환 + 사용량 증가
            await incrementUsage(userId, usageTier);

            // 읽기 기록 저장
            await saveReadingHistory(userId, paperId, translation.id);

            return res.json({
                success: true,
                cached: true,
                translation: {
                    id: translation.id,
                    paperId: translation.paper_id,
                    originalText: translation.original_text,  // 영문 원문 추가
                    translatedText: translation.translated_text,
                    sectionCount: translation.section_count,
                    wordCount: translation.word_count,
                    tokenCount: translation.token_count,
                    costUsd: parseFloat(translation.cost_usd),
                    tier: requestedTier,  // 프론트엔드에는 basic/advanced로 반환
                    model: translation.translation_tier,
                    createdAt: translation.created_at
                },
                usage: {
                    basicUsed: (usage.basic_count || 0) + (usageTier === 'basic' ? 1 : 0),
                    basicLimit: planLimits.basic,
                    premiumUsed: (usage.premium_count || 0) + (usageTier === 'premium' ? 1 : 0),
                    premiumLimit: planLimits.premium
                }
            });
        }

        // 7. 새로운 번역 시작 (On-demand)
        let translationId;

        if (translation && (translation.status === 'failed' || translation.status === 'processing')) {
            // 기존 실패/처리중 레코드 재사용
            translationId = translation.id;
            await update('paper_translations', { status: 'processing', error_message: null }, { id: translationId });
        } else {
            // 새 레코드 생성
            translationId = await insert('paper_translations', {
                paper_id: paperId,
                translation_tier: model,
                status: 'processing'
            });
        }

        try {
            // Python 스크립트로 PDF 다운로드, 구조 분석, 번역 수행
            console.log(`📥 논문 ${paperId} Python 번역 시작: ${paper.arxiv_id} (${model})`);
            const result = await pdfService.translatePaper(paper.arxiv_id, model, paperContext);

            // 번역 결과 저장
            await update('paper_translations', {
                original_text: result.originalText,
                translated_text: result.translatedText,
                section_count: result.sectionCount,
                word_count: result.wordCount,
                token_count: result.tokenCount,
                cost_usd: result.costUsd,
                status: 'completed',
                completed_at: new Date()
            }, { id: translationId });

            // 사용량 증가
            await incrementUsage(userId, usageTier);

            // 읽기 기록 저장
            await saveReadingHistory(userId, paperId, translationId);

            res.json({
                success: true,
                cached: false,
                translation: {
                    id: translationId,
                    paperId: paperId,
                    originalText: result.originalText,  // 영문 원문 추가
                    translatedText: result.translatedText,
                    sectionCount: result.sectionCount,
                    wordCount: result.wordCount,
                    tokenCount: result.tokenCount,
                    costUsd: result.costUsd,
                    tier: requestedTier,  // 프론트엔드에는 basic/advanced로 반환
                    model: model,
                    processingTime: result.processingTime
                },
                usage: {
                    basicUsed: (usage.basic_count || 0) + (usageTier === 'basic' ? 1 : 0),
                    basicLimit: planLimits.basic,
                    premiumUsed: (usage.premium_count || 0) + (usageTier === 'premium' ? 1 : 0),
                    premiumLimit: planLimits.premium
                }
            });

        } catch (translateError) {
            // 번역 실패 시 상태 업데이트
            await update('paper_translations', {
                status: 'failed',
                error_message: translateError.message
            }, { id: translationId });

            throw translateError;
        }

    } catch (error) {
        console.error('번역 요청 실패:', error);
        res.status(500).json({
            success: false,
            error: '번역 처리 중 오류가 발생했습니다.',
            message: error.message
        });
    }
};

/**
 * 번역 상태 조회
 * GET /api/v1/papers/:id/translation/status
 */
exports.getTranslationStatus = async (req, res) => {
    try {
        const paperId = parseInt(req.params.id);

        const translation = await queryOne(
            'SELECT id, paper_id, translation_tier, status, section_count, word_count, token_count, cost_usd, created_at, completed_at, error_message FROM paper_translations WHERE paper_id = ? ORDER BY created_at DESC LIMIT 1',
            [paperId]
        );

        if (!translation) {
            return res.json({
                success: true,
                available: false,
                status: 'none'
            });
        }

        res.json({
            success: true,
            available: translation.status === 'completed',
            status: translation.status,
            translation: translation.status === 'completed' ? {
                id: translation.id,
                tier: translation.translation_tier,
                sectionCount: translation.section_count,
                wordCount: translation.word_count,
                createdAt: translation.created_at
            } : null,
            error: translation.status === 'failed' ? translation.error_message : null
        });

    } catch (error) {
        console.error('번역 상태 조회 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 사용자 번역 사용량 조회
 * GET /api/v1/user/translation-usage
 */
exports.getUsage = async (req, res) => {
    try {
        const userId = req.user.id;
        const userRole = req.user.role;

        const usage = await getUserUsage(userId);
        const planLimits = PLAN_LIMITS[userRole] || { basic: 0, premium: 0 };

        res.json({
            success: true,
            usage: {
                basic: {
                    used: usage.basic_count || 0,
                    limit: planLimits.basic,
                    remaining: Math.max(0, planLimits.basic - (usage.basic_count || 0))
                },
                premium: {
                    used: usage.premium_count || 0,
                    limit: planLimits.premium,
                    remaining: Math.max(0, planLimits.premium - (usage.premium_count || 0))
                },
                periodMonth: usage.period_month,
                plan: userRole
            }
        });

    } catch (error) {
        console.error('사용량 조회 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 읽기 기록 저장
 */
async function saveReadingHistory(userId, paperId, translationId) {
    try {
        await insert('paper_reading_history', {
            user_id: userId,
            paper_id: paperId,
            translation_id: translationId
        });
    } catch (error) {
        // 중복 등 오류 무시
        console.log('읽기 기록 저장 (중복 가능):', error.message);
    }
}

/**
 * 읽기 기록 조회
 * GET /api/v1/user/reading-history
 */
exports.getReadingHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const type = req.query.type || 'all'; // all, abstract, basic, advanced

        // 번역 읽기 기록 쿼리 (basic, advanced)
        const translationHistoryQuery = `
            SELECT
                prh.id,
                prh.read_at,
                p.id as paper_id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.published_at,
                pt.translation_tier,
                pt.word_count,
                'translation' as record_type
            FROM paper_reading_history prh
            JOIN papers p ON prh.paper_id = p.id
            LEFT JOIN paper_translations pt ON prh.translation_id = pt.id
            WHERE prh.user_id = ?`;

        // 초록 읽기 기록 쿼리 (abstract)
        const abstractHistoryQuery = `
            SELECT
                rh.id,
                rh.read_at,
                p.id as paper_id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.published_at,
                NULL as translation_tier,
                NULL as word_count,
                'abstract' as record_type
            FROM reading_history rh
            JOIN papers p ON rh.paper_id = p.id
            WHERE rh.user_id = ?`;

        let combinedQuery;
        let queryParams;
        let countQuery;
        let countParams;

        if (type === 'abstract') {
            combinedQuery = `${abstractHistoryQuery} ORDER BY read_at DESC LIMIT ? OFFSET ?`;
            queryParams = [userId, limit, offset];
            countQuery = 'SELECT COUNT(*) as total FROM reading_history WHERE user_id = ?';
            countParams = [userId];
        } else if (type === 'basic') {
            combinedQuery = `${translationHistoryQuery} AND pt.translation_tier = 'haiku' ORDER BY read_at DESC LIMIT ? OFFSET ?`;
            queryParams = [userId, limit, offset];
            countQuery = `SELECT COUNT(*) as total FROM paper_reading_history prh
                          JOIN paper_translations pt ON prh.translation_id = pt.id
                          WHERE prh.user_id = ? AND pt.translation_tier = 'haiku'`;
            countParams = [userId];
        } else if (type === 'advanced') {
            combinedQuery = `${translationHistoryQuery} AND pt.translation_tier = 'sonnet' ORDER BY read_at DESC LIMIT ? OFFSET ?`;
            queryParams = [userId, limit, offset];
            countQuery = `SELECT COUNT(*) as total FROM paper_reading_history prh
                          JOIN paper_translations pt ON prh.translation_id = pt.id
                          WHERE prh.user_id = ? AND pt.translation_tier = 'sonnet'`;
            countParams = [userId];
        } else {
            // all: 번역 기록 + 초록 기록 모두 가져오기
            combinedQuery = `
                (${translationHistoryQuery})
                UNION ALL
                (${abstractHistoryQuery})
                ORDER BY read_at DESC
                LIMIT ? OFFSET ?`;
            queryParams = [userId, userId, limit, offset];
            countQuery = `
                SELECT
                    (SELECT COUNT(*) FROM paper_reading_history WHERE user_id = ?) +
                    (SELECT COUNT(*) FROM reading_history WHERE user_id = ?) as total`;
            countParams = [userId, userId];
        }

        const [history, countResult, statsResult] = await Promise.all([
            query(combinedQuery, queryParams),
            queryOne(countQuery, countParams),
            // 각 타입별 통계
            Promise.all([
                queryOne('SELECT COUNT(*) as count FROM reading_history WHERE user_id = ?', [userId]),
                queryOne(`SELECT COUNT(*) as count FROM paper_reading_history prh
                          JOIN paper_translations pt ON prh.translation_id = pt.id
                          WHERE prh.user_id = ? AND pt.translation_tier = 'haiku'`, [userId]),
                queryOne(`SELECT COUNT(*) as count FROM paper_reading_history prh
                          JOIN paper_translations pt ON prh.translation_id = pt.id
                          WHERE prh.user_id = ? AND pt.translation_tier = 'sonnet'`, [userId])
            ])
        ]);

        const [abstractStats, basicStats, advancedStats] = statsResult;

        res.json({
            success: true,
            history: history.map(h => ({
                id: h.id,
                readAt: h.read_at,
                paper: {
                    id: h.paper_id,
                    arxivId: h.arxiv_id,
                    titleEn: h.title_en,
                    titleKo: h.title_ko,
                    publishedAt: h.published_at
                },
                translationTier: h.translation_tier,
                wordCount: h.word_count,
                recordType: h.record_type
            })),
            stats: {
                abstract: abstractStats?.count || 0,
                basic: basicStats?.count || 0,
                advanced: advancedStats?.count || 0
            },
            pagination: {
                page,
                limit,
                total: countResult?.total || 0,
                totalPages: Math.ceil((countResult?.total || 0) / limit)
            }
        });

    } catch (error) {
        console.error('읽기 기록 조회 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 관리자: 번역 통계
 * GET /api/admin/translations/stats
 */
exports.getStats = async (req, res) => {
    try {
        let totalStats = { total_translations: 0, completed: 0, failed: 0, total_tokens: 0, total_cost: 0 };
        let monthlyStats = { monthly_translations: 0, monthly_tokens: 0, monthly_cost: 0 };
        let recentTranslations = [];
        let totalViews = 0;

        // 각 쿼리를 개별 try-catch로 감싸서 하나가 실패해도 다른 것들은 동작하도록
        try {
            const result = await queryOne(`
                SELECT
                    COUNT(*) as total_translations,
                    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
                    COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                    SUM(CASE WHEN status = 'completed' THEN token_count ELSE 0 END) as total_tokens,
                    SUM(CASE WHEN status = 'completed' THEN cost_usd ELSE 0 END) as total_cost
                FROM paper_translations
            `);
            if (result) totalStats = result;
        } catch (e) { console.error('Translation totalStats error:', e.message); }

        try {
            const result = await queryOne(`
                SELECT
                    COUNT(*) as monthly_translations,
                    SUM(token_count) as monthly_tokens,
                    SUM(cost_usd) as monthly_cost
                FROM paper_translations
                WHERE status = 'completed'
                AND YEAR(created_at) = YEAR(CURRENT_DATE())
                AND MONTH(created_at) = MONTH(CURRENT_DATE())
            `);
            if (result) monthlyStats = result;
        } catch (e) { console.error('Translation monthlyStats error:', e.message); }

        try {
            const result = await query(`
                SELECT
                    pt.id,
                    pt.paper_id,
                    p.title_ko,
                    p.arxiv_id,
                    pt.translation_tier,
                    pt.status,
                    pt.token_count,
                    pt.cost_usd,
                    pt.created_at,
                    pt.completed_at
                FROM paper_translations pt
                JOIN papers p ON pt.paper_id = p.id
                ORDER BY pt.created_at DESC
                LIMIT 20
            `);
            if (result) recentTranslations = result;
        } catch (e) { console.error('Translation recentTranslations error:', e.message); }

        try {
            const result = await queryOne('SELECT COUNT(*) as count FROM paper_reading_history');
            totalViews = result?.count || 0;
        } catch (e) { console.error('Translation totalViews error:', e.message); }

        res.json({
            success: true,
            stats: {
                total: {
                    translations: totalStats.total_translations || 0,
                    completed: totalStats.completed || 0,
                    failed: totalStats.failed || 0,
                    tokens: totalStats.total_tokens || 0,
                    costUsd: parseFloat(totalStats.total_cost) || 0,
                    views: totalViews
                },
                monthly: {
                    translations: monthlyStats.monthly_translations || 0,
                    tokens: monthlyStats.monthly_tokens || 0,
                    costUsd: parseFloat(monthlyStats.monthly_cost) || 0
                }
            },
            recentTranslations: (recentTranslations || []).map(t => ({
                id: t.id,
                paperId: t.paper_id,
                title: t.title_ko,
                arxivId: t.arxiv_id,
                tier: t.translation_tier,
                status: t.status,
                tokenCount: t.token_count,
                costUsd: parseFloat(t.cost_usd) || 0,
                createdAt: t.created_at,
                completedAt: t.completed_at
            }))
        });

    } catch (error) {
        console.error('번역 통계 조회 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 관리자: 번역 목록 조회 (페이지네이션)
 * GET /api/admin/translations
 */
exports.getTranslations = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const { search, status, tier } = req.query;

        let whereClause = '1=1';
        const params = [];

        if (status) {
            whereClause += ' AND pt.status = ?';
            params.push(status);
        }

        if (tier) {
            whereClause += ' AND pt.translation_tier = ?';
            params.push(tier);
        }

        if (search) {
            whereClause += ' AND (p.title_ko LIKE ? OR p.title_en LIKE ? OR p.arxiv_id LIKE ?)';
            const searchPattern = '%' + search + '%';
            params.push(searchPattern, searchPattern, searchPattern);
        }

        // 전체 개수
        const [countResult] = await query(
            `SELECT COUNT(*) as total FROM paper_translations pt
             JOIN papers p ON pt.paper_id = p.id
             WHERE ${whereClause}`,
            params
        );

        // 데이터 조회
        const translations = await query(
            `SELECT
                pt.id,
                pt.paper_id,
                p.arxiv_id,
                p.title_ko,
                p.title_en,
                pt.translation_tier,
                pt.status,
                pt.word_count,
                pt.token_count,
                pt.cost_usd,
                pt.created_at,
                pt.completed_at,
                pt.error_message,
                (SELECT COUNT(*) FROM paper_reading_history prh WHERE prh.translation_id = pt.id) as view_count
            FROM paper_translations pt
            JOIN papers p ON pt.paper_id = p.id
            WHERE ${whereClause}
            ORDER BY pt.created_at DESC
            LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        // 등급별 통계
        const tierStats = await query(`
            SELECT
                translation_tier,
                COUNT(*) as count,
                SUM(CASE WHEN status = 'completed' THEN cost_usd ELSE 0 END) as total_cost
            FROM paper_translations
            GROUP BY translation_tier
        `);

        const tierStatsMap = {};
        tierStats.forEach(t => {
            tierStatsMap[t.translation_tier] = {
                count: t.count,
                cost: parseFloat(t.total_cost) || 0
            };
        });

        res.json({
            success: true,
            data: translations.map(t => ({
                id: t.id,
                paperId: t.paper_id,
                arxivId: t.arxiv_id,
                paperTitle: t.title_ko || t.title_en,
                tier: t.translation_tier,
                status: t.status,
                wordCount: t.word_count,
                tokenCount: t.token_count,
                costUsd: parseFloat(t.cost_usd) || 0,
                createdAt: t.created_at,
                completedAt: t.completed_at,
                errorMessage: t.error_message,
                viewCount: t.view_count || 0
            })),
            tierStats: tierStatsMap,
            pagination: {
                page,
                limit,
                total: countResult.total,
                totalPages: Math.ceil(countResult.total / limit)
            }
        });

    } catch (error) {
        console.error('번역 목록 조회 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 관리자: 번역 상세 조회
 * GET /api/admin/translations/:id
 */
exports.getTranslationById = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const translation = await queryOne(
            `SELECT
                pt.*,
                p.arxiv_id,
                p.title_ko,
                p.title_en
            FROM paper_translations pt
            JOIN papers p ON pt.paper_id = p.id
            WHERE pt.id = ?`,
            [id]
        );

        if (!translation) {
            return res.status(404).json({ success: false, error: '번역을 찾을 수 없습니다.' });
        }

        res.json({
            success: true,
            data: {
                id: translation.id,
                paperId: translation.paper_id,
                arxivId: translation.arxiv_id,
                paperTitle: translation.title_ko || translation.title_en,
                tier: translation.translation_tier,
                status: translation.status,
                originalText: translation.original_text,
                translatedText: translation.translated_text,
                sectionCount: translation.section_count,
                wordCount: translation.word_count,
                tokenCount: translation.token_count,
                costUsd: parseFloat(translation.cost_usd) || 0,
                createdAt: translation.created_at,
                completedAt: translation.completed_at,
                errorMessage: translation.error_message
            }
        });

    } catch (error) {
        console.error('번역 상세 조회 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 관리자: 번역 삭제
 * DELETE /api/admin/translations/:id
 */
exports.deleteTranslation = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const translation = await queryOne('SELECT id FROM paper_translations WHERE id = ?', [id]);
        if (!translation) {
            return res.status(404).json({ success: false, error: '번역을 찾을 수 없습니다.' });
        }

        await query('DELETE FROM paper_translations WHERE id = ?', [id]);

        res.json({ success: true, message: '번역이 삭제되었습니다.' });

    } catch (error) {
        console.error('번역 삭제 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};

/**
 * 관리자: 실패한 번역 재시도
 * POST /api/admin/translations/:id/retry
 */
exports.retryTranslation = async (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const translation = await queryOne(
            `SELECT pt.*, p.arxiv_id, p.title_en
             FROM paper_translations pt
             JOIN papers p ON pt.paper_id = p.id
             WHERE pt.id = ?`,
            [id]
        );

        if (!translation) {
            return res.status(404).json({ success: false, error: '번역을 찾을 수 없습니다.' });
        }

        if (translation.status !== 'failed') {
            return res.status(400).json({ success: false, error: '실패한 번역만 재시도할 수 있습니다.' });
        }

        // 상태를 processing으로 변경
        await update('paper_translations', { status: 'processing', error_message: null }, { id });

        try {
            // PDF 다운로드 및 텍스트 추출
            console.log(`📥 번역 재시도: ${translation.arxiv_id} (${translation.translation_tier})`);
            const pdfData = await pdfService.extractFromArxiv(translation.arxiv_id);

            // Claude 모델로 번역
            const result = await aiService.translateFullText(pdfData.mainText, translation.translation_tier);

            // 번역 결과 저장
            await update('paper_translations', {
                original_text: pdfData.mainText,
                translated_text: result.translatedText,
                section_count: result.sectionCount,
                word_count: result.wordCount,
                token_count: result.tokenCount,
                cost_usd: result.costUsd,
                status: 'completed',
                completed_at: new Date()
            }, { id });

            res.json({
                success: true,
                message: '번역이 완료되었습니다.',
                data: {
                    tokenCount: result.tokenCount,
                    costUsd: result.costUsd
                }
            });

        } catch (translateError) {
            await update('paper_translations', {
                status: 'failed',
                error_message: translateError.message
            }, { id });

            throw translateError;
        }

    } catch (error) {
        console.error('번역 재시도 실패:', error);
        res.status(500).json({ success: false, error: error.message });
    }
};
