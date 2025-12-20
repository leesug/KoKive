/**
 * KoKive Library Controller
 * 개인 라이브러리 관련 비즈니스 로직 (FR-007)
 */

const { query, queryOne, insert, update, remove, paginate, transaction } = require('../config/database');
const { HTTP_STATUS, ERROR_CODES } = require('../config/constants');

// ===========================================
// 컬렉션 관련
// ===========================================

/**
 * 내 컬렉션 목록 조회
 */
exports.getCollections = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const collections = await query(`
            SELECT
                id, name, description, is_default, is_public, paper_count, created_at
            FROM collections
            WHERE user_id = ?
            ORDER BY is_default DESC, created_at DESC
        `, [userId]);

        res.json({
            success: true,
            data: collections.map(c => ({
                id: c.id,
                name: c.name,
                description: c.description,
                isDefault: c.is_default,
                isPublic: c.is_public,
                paperCount: c.paper_count,
                createdAt: c.created_at
            }))
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션 생성
 */
exports.createCollection = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { name, description, isPublic = false } = req.body;

        const collectionId = await insert('collections', {
            user_id: userId,
            name,
            description,
            is_public: isPublic
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '컬렉션이 생성되었습니다.',
            data: { id: collectionId }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션 상세 조회
 */
exports.getCollectionById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const collection = await queryOne(`
            SELECT * FROM collections WHERE id = ? AND user_id = ?
        `, [id, userId]);

        if (!collection) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '컬렉션을 찾을 수 없습니다.' }
            });
        }

        res.json({
            success: true,
            data: {
                id: collection.id,
                name: collection.name,
                description: collection.description,
                isDefault: collection.is_default,
                isPublic: collection.is_public,
                paperCount: collection.paper_count,
                createdAt: collection.created_at
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션 수정
 */
exports.updateCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        const { name, description, isPublic } = req.body;

        const collection = await queryOne(
            'SELECT is_default FROM collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );

        if (!collection) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '컬렉션을 찾을 수 없습니다.' }
            });
        }

        if (collection.is_default) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '기본 컬렉션은 수정할 수 없습니다.' }
            });
        }

        await update('collections', {
            name,
            description,
            is_public: isPublic
        }, { id, user_id: userId });

        res.json({
            success: true,
            message: '컬렉션이 수정되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션 삭제
 */
exports.deleteCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const collection = await queryOne(
            'SELECT is_default FROM collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );

        if (!collection) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '컬렉션을 찾을 수 없습니다.' }
            });
        }

        if (collection.is_default) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '기본 컬렉션은 삭제할 수 없습니다.' }
            });
        }

        await remove('collections', { id, user_id: userId });

        res.json({
            success: true,
            message: '컬렉션이 삭제되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션 내 논문 목록
 */
exports.getCollectionPapers = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const userId = req.user.id;

        // 컬렉션 접근 권한 확인
        const collection = await queryOne(
            'SELECT id FROM collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );

        if (!collection) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '컬렉션을 찾을 수 없습니다.' }
            });
        }

        const result = await paginate(`
            SELECT
                p.id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.primary_category,
                p.published_at,
                p.github_urls,
                ps.tldr,
                cp.note,
                cp.created_at as saved_at
            FROM collection_papers cp
            JOIN papers p ON cp.paper_id = p.id
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE cp.collection_id = ?
        `, [id], {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'cp.created_at DESC'
        });

        res.json({
            success: true,
            data: result.items.map(p => ({
                id: p.id,
                arxivId: p.arxiv_id,
                title: p.title_ko || p.title_en,
                category: p.primary_category,
                publishedDate: p.published_at,
                githubUrls: p.github_urls,
                tldr: p.tldr,
                note: p.note,
                savedAt: p.saved_at
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션에 논문 추가
 */
exports.addPaperToCollection = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { paperId, note } = req.body;
        const userId = req.user.id;

        // 컬렉션 접근 권한 확인
        const collection = await queryOne(
            'SELECT id FROM collections WHERE id = ? AND user_id = ?',
            [id, userId]
        );

        if (!collection) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '컬렉션을 찾을 수 없습니다.' }
            });
        }

        // 이미 추가됐는지 확인
        const existing = await queryOne(
            'SELECT id FROM collection_papers WHERE collection_id = ? AND paper_id = ?',
            [id, paperId]
        );

        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.ALREADY_EXISTS, message: '이미 컬렉션에 추가된 논문입니다.' }
            });
        }

        await transaction(async (conn) => {
            await conn.query(
                'INSERT INTO collection_papers (collection_id, paper_id, note) VALUES (?, ?, ?)',
                [id, paperId, note]
            );
            await conn.query(
                'UPDATE collections SET paper_count = paper_count + 1 WHERE id = ?',
                [id]
            );
            await conn.query(
                'UPDATE papers SET save_count = save_count + 1 WHERE id = ?',
                [paperId]
            );
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '논문이 컬렉션에 추가되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 컬렉션에서 논문 제거
 */
exports.removePaperFromCollection = async (req, res, next) => {
    try {
        const { collectionId, paperId } = req.params;
        const userId = req.user.id;

        // 컬렉션 접근 권한 확인
        const collection = await queryOne(
            'SELECT id FROM collections WHERE id = ? AND user_id = ?',
            [collectionId, userId]
        );

        if (!collection) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '컬렉션을 찾을 수 없습니다.' }
            });
        }

        await transaction(async (conn) => {
            const [result] = await conn.query(
                'DELETE FROM collection_papers WHERE collection_id = ? AND paper_id = ?',
                [collectionId, paperId]
            );

            if (result.affectedRows > 0) {
                await conn.query(
                    'UPDATE collections SET paper_count = paper_count - 1 WHERE id = ?',
                    [collectionId]
                );
                await conn.query(
                    'UPDATE papers SET save_count = save_count - 1 WHERE id = ?',
                    [paperId]
                );
            }
        });

        res.json({
            success: true,
            message: '논문이 컬렉션에서 제거되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// 저장한 논문 (기본 컬렉션)
// ===========================================

/**
 * 저장한 논문 목록
 */
exports.getSavedPapers = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20, category, q } = req.query;

        // 기본 컬렉션 확인 및 자동 생성
        let defaultCollection = await queryOne(
            'SELECT id FROM collections WHERE user_id = ? AND is_default = 1',
            [userId]
        );

        if (!defaultCollection) {
            // 기본 컬렉션 자동 생성
            const collectionId = await insert('collections', {
                user_id: userId,
                name: '저장한 논문',
                is_default: 1,
                is_public: 0
            });
            defaultCollection = { id: collectionId };
        }

        let sql = `
            SELECT
                p.id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.abstract_ko,
                p.primary_category,
                p.published_at as published_date,
                ps.tldr,
                cp.created_at as saved_at
            FROM collection_papers cp
            JOIN papers p ON cp.paper_id = p.id
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE cp.collection_id = ?
        `;
        const params = [defaultCollection.id];

        if (category) {
            sql += ' AND p.primary_category = ?';
            params.push(category);
        }

        if (q) {
            sql += ' AND (p.title_ko LIKE ? OR p.title_en LIKE ?)';
            params.push(`%${q}%`, `%${q}%`);
        }

        const result = await paginate(sql, params, {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'cp.created_at DESC'
        });

        // 전체 개수 조회
        const totalCount = await queryOne(
            'SELECT COUNT(*) as total FROM collection_papers WHERE collection_id = ?',
            [defaultCollection.id]
        );

        res.json({
            success: true,
            data: {
                papers: result.items.map(p => ({
                    id: p.id,
                    arxivId: p.arxiv_id,
                    title_ko: p.title_ko,
                    title: p.title_ko || p.title_en,
                    abstract_ko: p.abstract_ko,
                    primary_category: p.primary_category,
                    published_date: p.published_date,
                    tldr: p.tldr,
                    saved_at: p.saved_at,
                    created_at: p.saved_at
                })),
                pagination: result.pagination,
                total: totalCount?.total || 0
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 논문 저장 (기본 컬렉션에 추가)
 */
exports.savePaper = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const userId = req.user.id;

        // 기본 컬렉션 확인 및 자동 생성
        let defaultCollection = await queryOne(
            'SELECT id FROM collections WHERE user_id = ? AND is_default = 1',
            [userId]
        );

        if (!defaultCollection) {
            // 기본 컬렉션 자동 생성
            const collectionId = await insert('collections', {
                user_id: userId,
                name: '저장한 논문',
                is_default: 1,
                is_public: 0
            });
            defaultCollection = { id: collectionId };
        }

        // 이미 저장됐는지 확인
        const existing = await queryOne(
            'SELECT id FROM collection_papers WHERE collection_id = ? AND paper_id = ?',
            [defaultCollection.id, paperId]
        );

        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.ALREADY_EXISTS, message: '이미 저장된 논문입니다.' }
            });
        }

        await transaction(async (conn) => {
            await conn.query(
                'INSERT INTO collection_papers (collection_id, paper_id) VALUES (?, ?)',
                [defaultCollection.id, paperId]
            );
            await conn.query(
                'UPDATE collections SET paper_count = paper_count + 1 WHERE id = ?',
                [defaultCollection.id]
            );
            await conn.query(
                'UPDATE papers SET save_count = save_count + 1 WHERE id = ?',
                [paperId]
            );
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '논문이 저장되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 논문 저장 취소
 */
exports.unsavePaper = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const userId = req.user.id;

        // 기본 컬렉션 조회
        const defaultCollection = await queryOne(
            'SELECT id FROM collections WHERE user_id = ? AND is_default = 1',
            [userId]
        );

        await transaction(async (conn) => {
            const [result] = await conn.query(
                'DELETE FROM collection_papers WHERE collection_id = ? AND paper_id = ?',
                [defaultCollection.id, paperId]
            );

            if (result.affectedRows > 0) {
                await conn.query(
                    'UPDATE collections SET paper_count = paper_count - 1 WHERE id = ?',
                    [defaultCollection.id]
                );
                await conn.query(
                    'UPDATE papers SET save_count = save_count - 1 WHERE id = ?',
                    [paperId]
                );
            }
        });

        res.json({
            success: true,
            message: '저장이 취소되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 논문 저장 상태 확인
 */
exports.checkSaveStatus = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const userId = req.user.id;

        const saved = await queryOne(`
            SELECT cp.id FROM collection_papers cp
            JOIN collections c ON cp.collection_id = c.id
            WHERE c.user_id = ? AND c.is_default = 1 AND cp.paper_id = ?
        `, [userId, paperId]);

        res.json({
            success: true,
            data: { isSaved: !!saved }
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// 노트 관련
// ===========================================

/**
 * 내 노트 목록
 */
exports.getNotes = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { page = 1, limit = 20 } = req.query;

        const result = await paginate(`
            SELECT
                n.id,
                n.paper_id,
                n.content,
                n.highlight_text,
                n.created_at,
                p.title_ko,
                p.title_en
            FROM paper_notes n
            JOIN papers p ON n.paper_id = p.id
            WHERE n.user_id = ?
        `, [userId], {
            page: parseInt(page),
            limit: parseInt(limit),
            orderBy: 'n.updated_at DESC'
        });

        res.json({
            success: true,
            data: result.items.map(n => ({
                id: n.id,
                paperId: n.paper_id,
                paperTitle: n.title_ko || n.title_en,
                content: n.content,
                highlightText: n.highlight_text,
                createdAt: n.created_at
            })),
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 특정 논문의 내 노트 목록
 */
exports.getPaperNotes = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const userId = req.user.id;

        const notes = await query(`
            SELECT id, content, highlight_text, highlight_position, created_at, updated_at
            FROM paper_notes
            WHERE paper_id = ? AND user_id = ?
            ORDER BY created_at DESC
        `, [paperId, userId]);

        res.json({
            success: true,
            data: notes.map(n => ({
                id: n.id,
                content: n.content,
                highlightText: n.highlight_text,
                highlightPosition: n.highlight_position,
                createdAt: n.created_at,
                updatedAt: n.updated_at
            }))
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 노트 작성
 */
exports.createNote = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const { content, highlightText, highlightPosition } = req.body;
        const userId = req.user.id;

        const noteId = await insert('paper_notes', {
            paper_id: paperId,
            user_id: userId,
            content,
            highlight_text: highlightText,
            highlight_position: highlightPosition ? JSON.stringify(highlightPosition) : null
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '노트가 저장되었습니다.',
            data: { id: noteId }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 노트 수정
 */
exports.updateNote = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { content } = req.body;
        const userId = req.user.id;

        const affected = await update('paper_notes', { content }, { id, user_id: userId });

        if (affected === 0) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '노트를 찾을 수 없습니다.' }
            });
        }

        res.json({
            success: true,
            message: '노트가 수정되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 노트 삭제
 */
exports.deleteNote = async (req, res, next) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const affected = await remove('paper_notes', { id, user_id: userId });

        if (affected === 0) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '노트를 찾을 수 없습니다.' }
            });
        }

        res.json({
            success: true,
            message: '노트가 삭제되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 최근 본 논문 목록
 */
exports.getHistory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { limit = 50 } = req.query;

        const history = await query(`
            SELECT
                rh.paper_id,
                rh.read_at as viewed_at,
                rh.read_duration_seconds,
                p.title_ko as paper_title_ko,
                p.title_en as paper_title,
                p.primary_category
            FROM reading_history rh
            JOIN papers p ON rh.paper_id = p.id
            WHERE rh.user_id = ?
            ORDER BY rh.read_at DESC
            LIMIT ?
        `, [userId, parseInt(limit)]);

        res.json({
            success: true,
            data: history.map(h => ({
                paper_id: h.paper_id,
                viewed_at: h.viewed_at,
                read_duration_seconds: h.read_duration_seconds,
                paper_title_ko: h.paper_title_ko,
                paper_title: h.paper_title,
                primary_category: h.primary_category
            }))
        });
    } catch (error) {
        next(error);
    }
};

// ===========================================
// 즐겨찾기 카테고리 관련
// ===========================================

/**
 * 즐겨찾기 카테고리 목록 조회
 */
exports.getFavoriteCategories = async (req, res, next) => {
    try {
        const userId = req.user.id;

        const categories = await query(`
            SELECT id, category, created_at
            FROM user_favorite_categories
            WHERE user_id = ?
            ORDER BY created_at DESC
        `, [userId]);

        res.json({
            success: true,
            data: categories.map(c => ({
                id: c.id,
                category: c.category,
                createdAt: c.created_at
            }))
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 즐겨찾기 카테고리 추가
 */
exports.addFavoriteCategory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { category } = req.body;

        if (!category) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '카테고리를 입력해주세요.' }
            });
        }

        // 이미 추가됐는지 확인
        const existing = await queryOne(
            'SELECT id FROM user_favorite_categories WHERE user_id = ? AND category = ?',
            [userId, category]
        );

        if (existing) {
            return res.status(HTTP_STATUS.CONFLICT).json({
                success: false,
                error: { code: ERROR_CODES.ALREADY_EXISTS, message: '이미 즐겨찾기한 카테고리입니다.' }
            });
        }

        const id = await insert('user_favorite_categories', {
            user_id: userId,
            category
        });

        res.status(HTTP_STATUS.CREATED).json({
            success: true,
            message: '카테고리가 즐겨찾기에 추가되었습니다.',
            data: { id, category }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 즐겨찾기 카테고리 삭제
 */
exports.removeFavoriteCategory = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { category } = req.params;

        const affected = await remove('user_favorite_categories', {
            user_id: userId,
            category: decodeURIComponent(category)
        });

        if (affected === 0) {
            return res.status(HTTP_STATUS.NOT_FOUND).json({
                success: false,
                error: { code: ERROR_CODES.NOT_FOUND, message: '즐겨찾기한 카테고리를 찾을 수 없습니다.' }
            });
        }

        res.json({
            success: true,
            message: '카테고리가 즐겨찾기에서 제거되었습니다.'
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 즐겨찾기 카테고리 일괄 설정
 */
exports.setFavoriteCategories = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { categories } = req.body;

        if (!Array.isArray(categories)) {
            return res.status(HTTP_STATUS.BAD_REQUEST).json({
                success: false,
                error: { code: ERROR_CODES.VALIDATION_ERROR, message: '카테고리 목록이 필요합니다.' }
            });
        }

        await transaction(async (conn) => {
            // 기존 즐겨찾기 카테고리 삭제
            await conn.query('DELETE FROM user_favorite_categories WHERE user_id = ?', [userId]);

            // 새 카테고리 추가
            if (categories.length > 0) {
                const values = categories.map(cat => [userId, cat]);
                await conn.query(
                    'INSERT INTO user_favorite_categories (user_id, category) VALUES ?',
                    [values]
                );
            }
        });

        res.json({
            success: true,
            message: '즐겨찾기 카테고리가 설정되었습니다.',
            data: { categories }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 즐겨찾기 카테고리 체크 상태 확인
 */
exports.checkFavoriteCategoryStatus = async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { category } = req.params;

        const favorite = await queryOne(
            'SELECT id FROM user_favorite_categories WHERE user_id = ? AND category = ?',
            [userId, decodeURIComponent(category)]
        );

        res.json({
            success: true,
            data: { isFavorite: !!favorite }
        });
    } catch (error) {
        next(error);
    }
};
