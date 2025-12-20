/**
 * KoKive Shorts Controller (사용자 측)
 * 쇼츠폼 조회 및 트래킹 (FR-014 사용자 측)
 */

const { query, queryOne, paginate, insert } = require('../config/database');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

/**
 * 공개된 쇼츠폼 목록
 */
exports.getPublishedShorts = async (req, res, next) => {
    try {
        const { page = 1, limit = 20 } = req.query;

        const result = await paginate(`
            SELECT
                s.id,
                s.title,
                s.thumbnail_url,
                s.thumbnail_text,
                s.created_at,
                p.id as paper_id,
                p.title_ko as paper_title,
                p.primary_category,
                (SELECT GROUP_CONCAT(sp.platform) FROM shorts_platforms sp WHERE sp.shorts_id = s.id) as platforms
            FROM shorts s
            JOIN papers p ON s.paper_id = p.id
            WHERE s.status = 'published'
        `, [], {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 's.created_at DESC'
        });

        res.json({
            success: true,
            data: result.items.map(s => ({
                id: s.id,
                title: s.title,
                thumbnailUrl: s.thumbnail_url,
                thumbnailText: s.thumbnail_text,
                createdAt: s.created_at,
                paper: {
                    id: s.paper_id,
                    title: s.paper_title,
                    category: s.primary_category
                },
                platforms: s.platforms ? s.platforms.split(',') : []
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 쇼츠폼 상세 조회
 */
exports.getShortsById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const shorts = await queryOne(`
            SELECT
                s.*,
                p.id as paper_id,
                p.arxiv_id,
                p.title_ko as paper_title,
                p.primary_category,
                ps.tldr
            FROM shorts s
            JOIN papers p ON s.paper_id = p.id
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE s.id = ? AND s.status = 'published'
        `, [id]);

        if (!shorts) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '쇼츠폼을 찾을 수 없습니다.' }
            });
        }

        // 플랫폼 정보 조회
        const platforms = await query(`
            SELECT platform, video_url, tracking_url
            FROM shorts_platforms
            WHERE shorts_id = ?
        `, [id]);

        res.json({
            success: true,
            data: {
                id: shorts.id,
                title: shorts.title,
                script: {
                    hook: shorts.script_hook,
                    main: shorts.script_main,
                    cta: shorts.script_cta
                },
                thumbnailUrl: shorts.thumbnail_url,
                thumbnailText: shorts.thumbnail_text,
                createdAt: shorts.created_at,
                paper: {
                    id: shorts.paper_id,
                    arxivId: shorts.arxiv_id,
                    title: shorts.paper_title,
                    category: shorts.primary_category,
                    tldr: shorts.tldr
                },
                platforms: platforms.map(p => ({
                    platform: p.platform,
                    videoUrl: p.video_url,
                    trackingUrl: p.tracking_url
                }))
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 특정 논문의 쇼츠폼 목록
 */
exports.getShortsByPaper = async (req, res, next) => {
    try {
        const { paperId } = req.params;

        const shortsList = await query(`
            SELECT
                s.id,
                s.title,
                s.thumbnail_url,
                s.created_at,
                sp.platform,
                sp.video_url
            FROM shorts s
            LEFT JOIN shorts_platforms sp ON s.id = sp.shorts_id
            WHERE s.paper_id = ? AND s.status = 'published'
            ORDER BY s.created_at DESC
        `, [paperId]);

        // 쇼츠별로 그룹화
        const shortsMap = new Map();
        shortsList.forEach(s => {
            if (!shortsMap.has(s.id)) {
                shortsMap.set(s.id, {
                    id: s.id,
                    title: s.title,
                    thumbnailUrl: s.thumbnail_url,
                    createdAt: s.created_at,
                    platforms: []
                });
            }
            if (s.platform) {
                shortsMap.get(s.id).platforms.push({
                    platform: s.platform,
                    videoUrl: s.video_url
                });
            }
        });

        res.json({
            success: true,
            data: Array.from(shortsMap.values())
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 쇼츠폼 클릭 트래킹
 */
exports.trackClick = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { platform, utmSource, utmMedium, utmCampaign } = req.body;

        // 플랫폼 ID 조회
        const platformData = await queryOne(`
            SELECT id FROM shorts_platforms
            WHERE shorts_id = ? AND platform = ?
        `, [id, platform]);

        if (platformData) {
            // 오늘 날짜의 통계 업데이트 또는 생성
            const today = new Date().toISOString().split('T')[0];

            const existingStats = await queryOne(`
                SELECT id, clicks FROM shorts_stats
                WHERE shorts_platform_id = ? AND date = ?
            `, [platformData.id, today]);

            if (existingStats) {
                await query(
                    'UPDATE shorts_stats SET clicks = clicks + 1 WHERE id = ?',
                    [existingStats.id]
                );
            } else {
                await insert('shorts_stats', {
                    shorts_platform_id: platformData.id,
                    date: today,
                    clicks: 1
                });
            }
        }

        res.json({
            success: true,
            message: '클릭이 트래킹되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};
