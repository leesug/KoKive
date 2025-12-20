/**
 * KoKive Search Controller
 * 검색 관련 비즈니스 로직 (FR-003)
 * 개선: 하이브리드 검색 (LIKE + FULLTEXT) + 통합 검색 (논문/용어/Q&A)
 */

const { query, queryOne, paginate } = require('../config/database');
const { HTTP_STATUS, PAPER_CATEGORIES } = require('../config/constants');
const semanticSearchService = require('../services/semanticSearchService');

/**
 * 검색어 전처리 - 하이픈, 특수문자 처리
 */
function preprocessQuery(q) {
    if (!q) return '';
    // 하이픈을 공백으로도 검색할 수 있도록
    return q.trim();
}

/**
 * 하이브리드 검색 (제목 우선 LIKE + FULLTEXT 폴백)
 * 우선순위: 제목 정확 매칭 > 제목 부분 매칭 > 저자 매칭 > FULLTEXT
 */
exports.search = async (req, res, next) => {
    try {
        const {
            q,
            page = 1,
            limit = 20,
            category,
            hasCode,
            sort = 'relevance'
        } = req.query;

        if (!q || q.trim().length === 0) {
            return res.json({
                success: true,
                query: q,
                data: [],
                pagination: { page: 1, limit: parseInt(limit), total: 0, totalPages: 0 }
            });
        }

        const searchQuery = preprocessQuery(q);
        const pageNum = parseInt(page);
        const limitNum = Math.min(parseInt(limit), 100);

        // 하이픈이 포함된 검색어의 경우 공백 버전도 준비
        const searchVariants = [searchQuery];
        if (searchQuery.includes('-')) {
            searchVariants.push(searchQuery.replace(/-/g, ' '));
            searchVariants.push(searchQuery.replace(/-/g, ''));
        }

        let allResults = [];
        const seenIds = new Set();

        // 1단계: 제목 정확 매칭 (LIKE) - 가장 높은 우선순위 (priority: 10000)
        for (const variant of searchVariants) {
            const titleExactSql = `
                SELECT
                    p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
                    p.published_at as published_date, p.github_urls, p.view_count,
                    ps.tldr, 10000 as priority
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.processing_status IN ('completed', 'pending')
                  AND (p.title_en LIKE ? OR p.title_ko LIKE ?)
                  ${category ? 'AND p.primary_category = ?' : ''}
                  ${hasCode === 'true' ? "AND p.github_urls IS NOT NULL AND p.github_urls != '[]'" : ''}
                  ${hasCode === 'false' ? "AND (p.github_urls IS NULL OR p.github_urls = '[]')" : ''}
                ORDER BY p.view_count DESC
                LIMIT 50
            `;
            const titleParams = [`%${variant}%`, `%${variant}%`];
            if (category) titleParams.push(category);

            const titleResults = await query(titleExactSql, titleParams);
            for (const paper of titleResults) {
                if (!seenIds.has(paper.id)) {
                    seenIds.add(paper.id);
                    allResults.push(paper);
                }
            }
        }

        // 2단계: 저자 매칭 (priority: 5000)
        for (const variant of searchVariants) {
            const authorSql = `
                SELECT
                    p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
                    p.published_at as published_date, p.github_urls, p.view_count,
                    ps.tldr, 5000 as priority
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.processing_status IN ('completed', 'pending')
                  AND p.authors LIKE ?
                  ${category ? 'AND p.primary_category = ?' : ''}
                  ${hasCode === 'true' ? "AND p.github_urls IS NOT NULL AND p.github_urls != '[]'" : ''}
                  ${hasCode === 'false' ? "AND (p.github_urls IS NULL OR p.github_urls = '[]')" : ''}
                ORDER BY p.view_count DESC
                LIMIT 30
            `;
            const authorParams = [`%${variant}%`];
            if (category) authorParams.push(category);

            const authorResults = await query(authorSql, authorParams);
            for (const paper of authorResults) {
                if (!seenIds.has(paper.id)) {
                    seenIds.add(paper.id);
                    allResults.push(paper);
                }
            }
        }

        // 3단계: 초록 LIKE 매칭 (priority: 2000)
        for (const variant of searchVariants) {
            const abstractSql = `
                SELECT
                    p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
                    p.published_at as published_date, p.github_urls, p.view_count,
                    ps.tldr, 2000 as priority
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.processing_status IN ('completed', 'pending')
                  AND (p.abstract_en LIKE ? OR p.abstract_ko LIKE ?)
                  ${category ? 'AND p.primary_category = ?' : ''}
                  ${hasCode === 'true' ? "AND p.github_urls IS NOT NULL AND p.github_urls != '[]'" : ''}
                  ${hasCode === 'false' ? "AND (p.github_urls IS NULL OR p.github_urls = '[]')" : ''}
                ORDER BY p.view_count DESC
                LIMIT 30
            `;
            const abstractParams = [`%${variant}%`, `%${variant}%`];
            if (category) abstractParams.push(category);

            const abstractResults = await query(abstractSql, abstractParams);
            for (const paper of abstractResults) {
                if (!seenIds.has(paper.id)) {
                    seenIds.add(paper.id);
                    allResults.push(paper);
                }
            }
        }

        // 4단계: FULLTEXT 검색 폴백 (priority: 40) - 결과가 부족할 때만
        if (allResults.length < limitNum * 2) {
            try {
                const fulltextSql = `
                    SELECT
                        p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
                        p.published_at as published_date, p.github_urls, p.view_count,
                        ps.tldr,
                        MATCH(p.title_en, p.abstract_en, p.title_ko, p.abstract_ko) AGAINST(? IN NATURAL LANGUAGE MODE) * 40 as priority
                    FROM papers p
                    LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                    WHERE p.processing_status IN ('completed', 'pending')
                      AND MATCH(p.title_en, p.abstract_en, p.title_ko, p.abstract_ko) AGAINST(? IN NATURAL LANGUAGE MODE)
                      ${category ? 'AND p.primary_category = ?' : ''}
                      ${hasCode === 'true' ? "AND p.github_urls IS NOT NULL AND p.github_urls != '[]'" : ''}
                      ${hasCode === 'false' ? "AND (p.github_urls IS NULL OR p.github_urls = '[]')" : ''}
                    ORDER BY priority DESC
                    LIMIT 50
                `;
                const fulltextParams = [searchQuery, searchQuery];
                if (category) fulltextParams.push(category);

                const fulltextResults = await query(fulltextSql, fulltextParams);
                for (const paper of fulltextResults) {
                    if (!seenIds.has(paper.id)) {
                        seenIds.add(paper.id);
                        allResults.push(paper);
                    }
                }
            } catch (e) {
                // FULLTEXT 인덱스가 없거나 오류 시 무시
                console.log('FULLTEXT search fallback skipped:', e.message);
            }
        }

        // 정렬
        if (sort === 'relevance') {
            allResults.sort((a, b) => b.priority - a.priority || b.view_count - a.view_count);
        } else if (sort === 'latest') {
            allResults.sort((a, b) => new Date(b.published_date) - new Date(a.published_date));
        } else if (sort === 'views') {
            allResults.sort((a, b) => b.view_count - a.view_count);
        }

        // 페이지네이션
        const total = allResults.length;
        const totalPages = Math.ceil(total / limitNum);
        const startIndex = (pageNum - 1) * limitNum;
        const paginatedResults = allResults.slice(startIndex, startIndex + limitNum);

        res.json({
            success: true,
            query: q,
            data: paginatedResults.map(paper => ({
                id: paper.id,
                arxivId: paper.arxiv_id,
                title: paper.title_ko || paper.title_en,
                titleEn: paper.title_en,
                category: paper.primary_category,
                categoryName: PAPER_CATEGORIES[paper.primary_category]?.nameKo || paper.primary_category,
                publishedDate: paper.published_date,
                tldr: paper.tldr,
                hasCode: paper.github_urls && paper.github_urls !== '[]',
                githubUrls: paper.github_urls,
                viewCount: paper.view_count,
                relevance: paper.priority
            })),
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages,
                hasNext: pageNum < totalPages,
                hasPrev: pageNum > 1
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 통합 검색 - 논문, 용어, Q&A 동시 검색
 */
exports.unifiedSearch = async (req, res, next) => {
    try {
        const {
            q,
            type = 'all', // all, papers, terms, questions
            limit = 10
        } = req.query;

        if (!q || q.trim().length === 0) {
            return res.json({
                success: true,
                query: q,
                papers: [],
                terms: [],
                questions: [],
                total: 0
            });
        }

        const searchQuery = preprocessQuery(q);
        const limitNum = Math.min(parseInt(limit), 20);

        const results = {
            papers: [],
            terms: [],
            questions: [],
            total: 0
        };

        // 논문 검색
        if (type === 'all' || type === 'papers') {
            const paperSql = `
                SELECT
                    p.id, p.arxiv_id, p.title_en, p.title_ko, p.primary_category,
                    p.published_at as published_date, p.view_count, ps.tldr,
                    CASE
                        WHEN p.title_en LIKE ? OR p.title_ko LIKE ? THEN 100
                        WHEN p.authors LIKE ? THEN 80
                        ELSE 50
                    END as priority
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.processing_status IN ('completed', 'pending')
                  AND (p.title_en LIKE ? OR p.title_ko LIKE ? OR p.authors LIKE ?
                       OR p.abstract_en LIKE ? OR p.abstract_ko LIKE ?)
                ORDER BY priority DESC, p.view_count DESC
                LIMIT ?
            `;
            const likePattern = `%${searchQuery}%`;
            const papers = await query(paperSql, [
                likePattern, likePattern, likePattern,
                likePattern, likePattern, likePattern, likePattern, likePattern,
                limitNum
            ]);

            results.papers = papers.map(p => ({
                id: p.id,
                type: 'paper',
                title: p.title_ko || p.title_en,
                titleEn: p.title_en,
                category: p.primary_category,
                categoryName: PAPER_CATEGORIES[p.primary_category]?.nameKo || p.primary_category,
                publishedDate: p.published_date,
                tldr: p.tldr,
                viewCount: p.view_count
            }));
        }

        // 용어 검색
        if (type === 'all' || type === 'terms') {
            const termSql = `
                SELECT
                    id, term_en, term_ko, definition_ko, category,
                    CASE
                        WHEN term_en LIKE ? OR term_ko LIKE ? THEN 100
                        ELSE 50
                    END as priority
                FROM terms
                WHERE term_en LIKE ? OR term_ko LIKE ? OR definition_ko LIKE ?
                ORDER BY priority DESC
                LIMIT ?
            `;
            const likePattern = `%${searchQuery}%`;
            const terms = await query(termSql, [
                likePattern, likePattern,
                likePattern, likePattern, likePattern,
                limitNum
            ]);

            results.terms = terms.map(t => ({
                id: t.id,
                type: 'term',
                termEn: t.term_en,
                termKo: t.term_ko,
                definition: t.definition_ko,
                category: t.category
            }));
        }

        // Q&A 검색
        if (type === 'all' || type === 'questions') {
            try {
                const questionSql = `
                    SELECT
                        q.id, q.title, q.content, q.paper_id, q.created_at, q.view_count,
                        u.nickname as author_name,
                        CASE
                            WHEN q.title LIKE ? THEN 100
                            ELSE 50
                        END as priority
                    FROM questions q
                    LEFT JOIN users u ON q.user_id = u.id
                    WHERE q.title LIKE ? OR q.content LIKE ?
                    ORDER BY priority DESC, q.created_at DESC
                    LIMIT ?
                `;
                const likePattern = `%${searchQuery}%`;
                const questions = await query(questionSql, [
                    likePattern, likePattern, likePattern, limitNum
                ]);

                results.questions = questions.map(q => ({
                    id: q.id,
                    type: 'question',
                    title: q.title,
                    content: q.content ? q.content.substring(0, 200) + '...' : '',
                    paperId: q.paper_id,
                    authorName: q.author_name,
                    createdAt: q.created_at,
                    viewCount: q.view_count
                }));
            } catch (e) {
                // questions 테이블이 없거나 오류 시 빈 배열
                console.log('Questions search skipped:', e.message);
            }
        }

        results.total = results.papers.length + results.terms.length + results.questions.length;

        res.json({
            success: true,
            query: q,
            ...results
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 시맨틱 검색 (벡터 유사도 기반)
 */
exports.semanticSearch = async (req, res, next) => {
    try {
        const {
            q,
            page = 1,
            limit = 20,
            category,
            hasCode,
            minScore = 0.5
        } = req.query;

        const result = await semanticSearchService.search(q, {
            limit: Math.min(parseInt(limit), 100),
            page: parseInt(page),
            category,
            hasCode: hasCode !== undefined ? hasCode === 'true' : null,
            minScore: parseFloat(minScore)
        });

        res.json({
            success: true,
            query: q,
            searchType: result.searchType,
            note: result.note || null,
            data: result.items,
            pagination: result.pagination
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 유사 논문 검색
 */
exports.findSimilar = async (req, res, next) => {
    try {
        const { paperId } = req.params;
        const { limit = 5 } = req.query;

        const results = await semanticSearchService.findSimilarPapers(
            parseInt(paperId),
            Math.min(parseInt(limit), 20)
        );

        res.json({
            success: true,
            data: results
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 임베딩 상태 조회 (관리자용)
 */
exports.getEmbeddingStatus = async (req, res, next) => {
    try {
        const status = await semanticSearchService.getEmbeddingPendingCount();
        const queueStatus = await require('../jobs/embeddingProcessor').getQueueStatus();

        res.json({
            success: true,
            data: {
                pendingCount: status,
                ...queueStatus
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 임베딩 배치 생성 트리거 (관리자용)
 */
exports.triggerEmbeddingBatch = async (req, res, next) => {
    try {
        const { batchSize = 10 } = req.body;
        const embeddingProcessor = require('../jobs/embeddingProcessor');

        const result = await embeddingProcessor.runManual(parseInt(batchSize));

        res.json({
            success: result.success,
            message: result.message || '임베딩 생성 작업 완료',
            data: result.data || null
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 검색어 자동완성
 */
exports.getSuggestions = async (req, res, next) => {
    try {
        const { q } = req.query;

        if (!q || q.length < 2) {
            return res.json({
                success: true,
                data: []
            });
        }

        // 제목에서 매칭되는 것 찾기
        const suggestions = await query(`
            SELECT DISTINCT
                CASE
                    WHEN title_ko LIKE ? THEN title_ko
                    ELSE title_en
                END as suggestion
            FROM papers
            WHERE processing_status IN ('completed', 'pending')
              AND (title_en LIKE ? OR title_ko LIKE ?)
            LIMIT 10
        `, [`%${q}%`, `%${q}%`, `%${q}%`]);

        res.json({
            success: true,
            data: suggestions.map(s => s.suggestion)
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 인기 검색어
 */
exports.getPopularSearches = async (req, res, next) => {
    try {
        // TODO: 검색 로그 테이블 구현 후 실제 인기 검색어 반환
        const popularSearches = [
            'GPT-4', 'LLM', 'Transformer', 'Diffusion',
            'RAG', 'Mamba', 'Vision', 'Multimodal',
            'Fine-tuning', 'RLHF'
        ];

        res.json({
            success: true,
            data: popularSearches
        });
    } catch (error) {
        next(error);
    }
};

/**
 * 최근 검색어
 */
exports.getRecentSearches = async (req, res, next) => {
    try {
        if (!req.user) {
            return res.json({
                success: true,
                data: []
            });
        }

        // TODO: 사용자별 검색 기록 테이블 구현 후 반환
        res.json({
            success: true,
            data: []
        });
    } catch (error) {
        next(error);
    }
};
