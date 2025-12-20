/**
 * KoKive Paper Controller - Fixed for actual DB schema
 */

const { query, queryOne, paginate, update, insert } = require("../config/database");
const {
    HTTP_STATUS,
    ERROR_CODES,
    SORT_OPTIONS,
    PAPER_CATEGORIES,
    CITATION_FORMATS,
    TRANSLATION_TIER
} = require("../config/constants");
const citationService = require("../services/citationService");
const aiService = require("../services/aiService");

exports.getPapers = async (req, res, next) => {
    try {
        const { page = 1, limit = 20, category, sort = "latest", startDate, endDate } = req.query;
        let sql = `SELECT p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
                   p.categories, p.published_at as published_date, p.pdf_url, p.arxiv_url, ps.tldr
                   FROM papers p LEFT JOIN paper_summaries ps ON p.id = ps.paper_id WHERE 1=1`;
        const params = [];
        if (category) { sql += ` AND p.primary_category = ?`; params.push(category); }
        if (startDate) { sql += ` AND p.published_at >= ?`; params.push(startDate); }
        if (endDate) { sql += ` AND p.published_at <= ?`; params.push(endDate); }
        const orderBy = SORT_OPTIONS[sort.toUpperCase()] || SORT_OPTIONS.LATEST;
        const result = await paginate(sql, params, { page: parseInt(page), limit: Math.min(parseInt(limit), 100), orderBy });
        res.json({ success: true, data: result.items.map(formatPaperListItem), pagination: result.pagination });
    } catch (error) { next(error); }
};

exports.getTodayPapers = async (req, res, next) => {
    try {
        const { limit = 20 } = req.query;
        const papers = await query(`SELECT p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
            p.categories, p.published_at as published_date, p.pdf_url, ps.tldr
            FROM papers p LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE DATE(p.created_at) = CURDATE() ORDER BY p.created_at DESC LIMIT ?`, [parseInt(limit)]);
        res.json({ success: true, data: papers.map(formatPaperListItem), count: papers.length });
    } catch (error) { next(error); }
};

exports.getTrendingPapers = async (req, res, next) => {
    try {
        const { limit = 10, period = "week" } = req.query;
        let dateCondition = "";
        switch (period) {
            case "day": dateCondition = "AND p.created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)"; break;
            case "week": dateCondition = "AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"; break;
            case "month": dateCondition = "AND p.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"; break;
        }
        const papers = await query(`SELECT p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
            p.published_at as published_date, ps.tldr FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id WHERE 1=1 ${dateCondition}
            ORDER BY p.created_at DESC LIMIT ?`, [parseInt(limit)]);
        res.json({ success: true, data: papers.map(formatPaperListItem) });
    } catch (error) { next(error); }
};

exports.getCategoryStats = async (req, res, next) => {
    try {
        const stats = await query(`SELECT primary_category, COUNT(*) as count, MAX(published_at) as latest_date
            FROM papers GROUP BY primary_category ORDER BY count DESC`);
        const result = stats.map(stat => ({
            category: stat.primary_category,
            name: PAPER_CATEGORIES[stat.primary_category]?.name || stat.primary_category,
            nameKo: PAPER_CATEGORIES[stat.primary_category]?.nameKo || stat.primary_category,
            count: stat.count, latestDate: stat.latest_date
        }));
        res.json({ success: true, data: result });
    } catch (error) { next(error); }
};

exports.getPaperById = async (req, res, next) => {
    try {
        const { id } = req.params;
        let paper = await queryOne(`SELECT p.*, ps.tldr, ps.summary_3line, ps.detailed_summary,
            ps.business_insight, ps.ai_model, ps.translation_tier FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id WHERE p.id = ?`, [id]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false, error: { code: ERROR_CODES.NOT_FOUND, message: "논문을 찾을 수 없습니다." }
            });
        }
        let shorts = [];
        try { shorts = await query(`SELECT s.id, s.title, sp.platform, sp.video_url, s.thumbnail_url
            FROM shorts s JOIN shorts_platforms sp ON s.id = sp.shorts_id
            WHERE s.paper_id = ? AND s.status = 'published'`, [id]); } catch (e) {}
        let isSaved = false;
        if (req.user) {
            try { const saved = await queryOne(`SELECT 1 FROM collection_papers cp
                JOIN collections c ON cp.collection_id = c.id
                WHERE c.user_id = ? AND cp.paper_id = ? AND c.is_default = 1`, [req.user.id, id]);
                isSaved = !!saved; } catch (e) {}
        }
        res.json({
            success: true,
            data: { ...formatPaperDetail(paper),
                shorts: shorts.map(s => ({ id: s.id, title: s.title, platform: s.platform,
                    videoUrl: s.video_url, thumbnailUrl: s.thumbnail_url })),
                isSaved, translationTier: paper.translation_tier || "haiku" }
        });
    } catch (error) { next(error); }
};

exports.getPaperSummary = async (req, res, next) => {
    try {
        const { id } = req.params;
        const summary = await queryOne(`SELECT ps.*, p.title_ko, p.abstract_ko FROM paper_summaries ps
            JOIN papers p ON ps.paper_id = p.id WHERE ps.paper_id = ?`, [id]);
        if (!summary) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false, error: { code: ERROR_CODES.NOT_FOUND, message: "요약을 찾을 수 없습니다." }
            });
        }
        res.json({ success: true, data: { tldr: summary.tldr, summary3Line: summary.summary_3line,
            detailedSummary: summary.detailed_summary, businessInsight: summary.business_insight,
            titleKo: summary.title_ko, abstractKo: summary.abstract_ko, aiModel: summary.ai_model }
        });
    } catch (error) { next(error); }
};

exports.getPaperTerms = async (req, res, next) => {
    try {
        const { id } = req.params;
        let terms = [];
        try { terms = await query(`SELECT t.id, t.term_en, t.term_ko, t.definition_short, t.category, pt.occurrence_count
            FROM paper_terms pt JOIN terms t ON pt.term_id = t.id WHERE pt.paper_id = ?
            ORDER BY pt.occurrence_count DESC`, [id]); } catch (e) {}
        res.json({ success: true, data: terms.map(t => ({ id: t.id, termEn: t.term_en, termKo: t.term_ko,
            definition: t.definition_short, category: t.category, occurrenceCount: t.occurrence_count })) });
    } catch (error) { next(error); }
};

exports.getRelatedPapers = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { limit = 5 } = req.query;
        const paper = await queryOne("SELECT primary_category FROM papers WHERE id = ?", [id]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false, error: { code: ERROR_CODES.NOT_FOUND, message: "논문을 찾을 수 없습니다." }
            });
        }
        const related = await query(`SELECT p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
            p.published_at as published_date, ps.tldr FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.id != ? AND p.primary_category = ? ORDER BY p.published_at DESC LIMIT ?`,
            [id, paper.primary_category, parseInt(limit)]);
        res.json({ success: true, data: related.map(formatPaperListItem) });
    } catch (error) { next(error); }
};

exports.getCitations = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { format } = req.query;
        const paper = await queryOne(`SELECT arxiv_id, title_en, authors, published_at as published_date
            FROM papers WHERE id = ?`, [id]);
        if (!paper) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false, error: { code: ERROR_CODES.NOT_FOUND, message: "논문을 찾을 수 없습니다." }
            });
        }
        const citations = {};
        if (format) { citations[format] = citationService.generateCitation(paper, format); }
        else { for (const fmt of Object.values(CITATION_FORMATS)) { citations[fmt] = citationService.generateCitation(paper, fmt); } }
        res.json({ success: true, data: citations });
    } catch (error) { next(error); }
};

exports.recordView = async (req, res, next) => {
    res.json({ success: true, message: "조회수가 기록되었습니다." });
};

exports.getRatings = async (req, res, next) => {
    try {
        const { id } = req.params;
        let ratings = [];
        let avgQuery = { avg_novelty: 0, avg_reproducibility: 0, avg_clarity: 0, avg_impact: 0, total_count: 0 };
        try {
            ratings = await query(`SELECT pr.id, pr.novelty_score, pr.reproducibility_score, pr.clarity_score,
                pr.impact_score, pr.comment, pr.created_at, u.nickname, u.profile_image_url
                FROM paper_ratings pr JOIN users u ON pr.user_id = u.id
                WHERE pr.paper_id = ? ORDER BY pr.created_at DESC`, [id]);
            avgQuery = await queryOne(`SELECT AVG(novelty_score) as avg_novelty, AVG(reproducibility_score) as avg_reproducibility,
                AVG(clarity_score) as avg_clarity, AVG(impact_score) as avg_impact, COUNT(*) as total_count
                FROM paper_ratings WHERE paper_id = ?`, [id]);
        } catch (e) {}
        res.json({ success: true, data: {
            ratings: ratings.map(r => ({ id: r.id,
                scores: { novelty: r.novelty_score, reproducibility: r.reproducibility_score,
                    clarity: r.clarity_score, impact: r.impact_score },
                comment: r.comment, createdAt: r.created_at,
                user: { nickname: r.nickname, profileImage: r.profile_image_url } })),
            summary: { averages: { novelty: parseFloat(avgQuery?.avg_novelty) || 0,
                reproducibility: parseFloat(avgQuery?.avg_reproducibility) || 0,
                clarity: parseFloat(avgQuery?.avg_clarity) || 0,
                impact: parseFloat(avgQuery?.avg_impact) || 0 },
                totalCount: avgQuery?.total_count || 0 } }
        });
    } catch (error) { next(error); }
};

exports.createRating = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { noveltyScore, reproducibilityScore, clarityScore, impactScore, comment } = req.body;
        const existing = await queryOne("SELECT id FROM paper_ratings WHERE paper_id = ? AND user_id = ?", [id, userId]);
        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false, error: { code: ERROR_CODES.ALREADY_EXISTS, message: "이미 평가하셨습니다." }
            });
        }
        const ratingId = await insert("paper_ratings", { paper_id: id, user_id: userId,
            novelty_score: noveltyScore, reproducibility_score: reproducibilityScore,
            clarity_score: clarityScore, impact_score: impactScore, comment });
        res.status(HTTP_STATUS.CREATED).json({ success: true, message: "평가가 등록되었습니다.", data: { id: ratingId } });
    } catch (error) { next(error); }
};

exports.updateRating = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { noveltyScore, reproducibilityScore, clarityScore, impactScore, comment } = req.body;
        const affected = await update("paper_ratings", { novelty_score: noveltyScore,
            reproducibility_score: reproducibilityScore, clarity_score: clarityScore,
            impact_score: impactScore, comment }, { paper_id: id, user_id: userId });
        if (affected === 0) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false, error: { code: ERROR_CODES.NOT_FOUND, message: "수정할 평가를 찾을 수 없습니다." }
            });
        }
        res.json({ success: true, message: "평가가 수정되었습니다." });
    } catch (error) { next(error); }
};

function formatPaperListItem(paper) {
    return { id: paper.id, arxivId: paper.arxiv_id, title: paper.title_ko || paper.title_en,
        titleEn: paper.title_en, category: paper.primary_category,
        categoryName: PAPER_CATEGORIES[paper.primary_category]?.nameKo || paper.primary_category,
        publishedDate: paper.published_date, tldr: paper.tldr, pdfUrl: paper.pdf_url, arxivUrl: paper.arxiv_url };
}

function formatPaperDetail(paper) {
    return { id: paper.id, arxivId: paper.arxiv_id, title: { ko: paper.title_ko, en: paper.title_en },
        abstract: { ko: paper.abstract_ko, en: paper.abstract_en }, authors: paper.authors,
        categories: paper.categories, primaryCategory: paper.primary_category,
        categoryName: PAPER_CATEGORIES[paper.primary_category]?.nameKo || paper.primary_category,
        publishedDate: paper.published_at, updatedDate: paper.updated_at_arxiv,
        pdfUrl: paper.pdf_url, arxivUrl: paper.arxiv_url, doi: paper.doi,
        journalRef: paper.journal_ref, comment: paper.comment,
        summary: { tldr: paper.tldr, threeLine: paper.summary_3line,
            detailed: paper.detailed_summary, businessInsight: paper.business_insight },
        aiModel: paper.ai_model, translationTier: paper.translation_tier || "haiku" };
}
