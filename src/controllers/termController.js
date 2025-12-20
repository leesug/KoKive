/**
 * KoKive Term Controller
 * 전문 용어 관련 비즈니스 로직 (FR-004)
 */

const { query, queryOne, paginate } = require('../config/database');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

/**
 * 용어 목록 조회
 */
exports.getTerms = async (req, res, next) => {
    try {
        const { page = 1, limit = 50, category, search, q } = req.query;
        const searchQuery = (search || q || '').trim();

        let sql = 'SELECT id, term_en, term_ko, definition_ko, category, related_terms, example_sentence FROM terms';
        const params = [];
        const conditions = [];

        // 검색어 처리
        if (searchQuery) {
            conditions.push('(term_en LIKE ? OR term_ko LIKE ? OR definition_ko LIKE ?)');
            params.push(`%${searchQuery}%`, `%${searchQuery}%`, `%${searchQuery}%`);
        }

        if (category) {
            conditions.push('category = ?');
            params.push(category);
        }

        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }

        const result = await paginate(sql, params, {
            page: parseInt(page),
            limit: Math.min(parseInt(limit), 100),
            orderBy: searchQuery ?
                `CASE WHEN term_en = '${searchQuery.replace(/'/g, "''")}' OR term_ko = '${searchQuery.replace(/'/g, "''")}' THEN 1 WHEN term_en LIKE '${searchQuery.replace(/'/g, "''")}%' OR term_ko LIKE '${searchQuery.replace(/'/g, "''")}%' THEN 2 ELSE 3 END, term_en ASC` :
                'term_en ASC'
        });

        res.json({
            success: true,
            data: result.items.map(term => ({
                id: term.id,
                termEn: term.term_en,
                termKo: term.term_ko,
                definition: term.definition_ko,
                category: term.category,
                relatedTerms: term.related_terms,
                example: term.example_sentence
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 용어 검색
 */
exports.searchTerms = async (req, res, next) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q || q.length < 1) {
            return res.json({
                success: true,
                data: []
            });
        }

        const terms = await query(`
            SELECT
                id, term_en, term_ko, definition_ko, category, related_terms, example_sentence
            FROM terms
            WHERE term_en LIKE ? OR term_ko LIKE ? OR definition_ko LIKE ?
            ORDER BY
                CASE
                    WHEN term_en = ? OR term_ko = ? THEN 1
                    WHEN term_en LIKE ? OR term_ko LIKE ? THEN 2
                    ELSE 3
                END
            LIMIT ?
        `, [
            `%${q}%`, `%${q}%`, `%${q}%`,
            q, q,
            `${q}%`, `${q}%`,
            parseInt(limit)
        ]);

        res.json({
            success: true,
            query: q,
            data: terms.map(term => ({
                id: term.id,
                termEn: term.term_en,
                termKo: term.term_ko,
                definition: term.definition_ko,
                category: term.category,
                relatedTerms: term.related_terms,
                example: term.example_sentence
            }))
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 용어 상세 조회
 */
exports.getTermById = async (req, res, next) => {
    try {
        const { id } = req.params;

        const term = await queryOne(`
            SELECT
                id, term_en, term_ko,
                definition_ko, category, related_terms, example_sentence
            FROM terms
            WHERE id = ?
        `, [id]);

        if (!term) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: {
                    code: ERROR_CODES.NOT_FOUND,
                    message: '용어를 찾을 수 없습니다.'
                }
            });
        }

        res.json({
            success: true,
            data: {
                id: term.id,
                termEn: term.term_en,
                termKo: term.term_ko,
                definition: term.definition_ko,
                category: term.category,
                relatedTerms: term.related_terms,
                example: term.example_sentence
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 용어 조회 (영어/한국어 용어로 검색) - Tooltip용
 */
exports.lookupTerm = async (req, res, next) => {
    try {
        const { term } = req.params;

        const found = await queryOne(`
            SELECT
                id, term_en, term_ko,
                definition_ko, category
            FROM terms
            WHERE term_en = ? OR term_ko = ?
        `, [term, term]);

        if (!found) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: {
                    code: ERROR_CODES.NOT_FOUND,
                    message: '용어를 찾을 수 없습니다.'
                }
            });
        }

        res.json({
            success: true,
            data: {
                id: found.id,
                termEn: found.term_en,
                termKo: found.term_ko,
                definition: found.definition_ko,
                category: found.category
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 용어 카테고리 목록
 */
exports.getCategories = async (req, res, next) => {
    try {
        const categories = await query(`
            SELECT
                category,
                COUNT(*) as count
            FROM terms
            WHERE category IS NOT NULL
            GROUP BY category
            ORDER BY count DESC
        `);

        res.json({
            success: true,
            data: categories.map(c => ({
                name: c.category,
                count: c.count
            }))
        });
    } catch (error) {
        next(error);
    }
};
