/**
 * KoKive Semantic Search Service
 * 벡터 임베딩 기반 시맨틱 검색 (FR-003)
 */

const { query, queryOne, insert, update } = require('../config/database');
const aiService = require('./aiService');

class SemanticSearchService {
    constructor() {
        this.embeddingDimension = 1536; // text-embedding-3-small 차원
    }

    /**
     * 논문 임베딩 생성 및 저장
     * @param {number} paperId - 논문 ID
     * @param {string} text - 임베딩할 텍스트 (제목 + 초록)
     */
    async generateAndSaveEmbedding(paperId, text) {
        if (!aiService.isAvailable()) {
            console.warn('AI 서비스 비활성화 - 임베딩 생성 건너뜀');
            return null;
        }

        try {
            // 임베딩 생성
            const embedding = await aiService.generateEmbedding(text);

            // 벡터를 Buffer로 변환하여 BLOB에 저장
            const embeddingBuffer = this.vectorToBuffer(embedding);

            // 기존 임베딩 확인
            const existing = await queryOne(
                'SELECT id FROM paper_embeddings WHERE paper_id = ?',
                [paperId]
            );

            if (existing) {
                // 업데이트
                await update('paper_embeddings',
                    { embedding_vector: embeddingBuffer },
                    'paper_id = ?',
                    [paperId]
                );
            } else {
                // 신규 생성
                await insert('paper_embeddings', {
                    paper_id: paperId,
                    embedding_model: 'text-embedding-3-small',
                    embedding_vector: embeddingBuffer
                });
            }

            console.log(`✅ 논문 ${paperId} 임베딩 저장 완료`);
            return embedding;
        } catch (error) {
            console.error(`❌ 논문 ${paperId} 임베딩 생성 실패:`, error.message);
            throw error;
        }
    }

    /**
     * 시맨틱 검색 수행
     * @param {string} queryText - 검색 쿼리
     * @param {Object} options - 검색 옵션
     */
    async search(queryText, options = {}) {
        const {
            limit = 20,
            page = 1,
            category = null,
            hasCode = null,
            minScore = 0.5
        } = options;

        if (!aiService.isAvailable()) {
            // AI 서비스 비활성화 시 키워드 검색으로 폴백
            return this.fallbackKeywordSearch(queryText, options);
        }

        try {
            // 쿼리 텍스트 임베딩 생성
            const queryEmbedding = await aiService.generateEmbedding(queryText);

            // 모든 논문 임베딩 가져오기
            let sql = `
                SELECT
                    pe.paper_id,
                    pe.embedding_vector,
                    p.arxiv_id,
                    p.title_en,
                    p.title_ko,
                    p.abstract_ko,
                    p.primary_category,
                    p.published_at,
                    ps.tldr,
                    pcl.stars as github_stars,
                    pcl.repo_url as github_url,
                    (pcl.id IS NOT NULL) as has_code
                FROM paper_embeddings pe
                JOIN papers p ON pe.paper_id = p.id
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                LEFT JOIN paper_code_links pcl ON p.id = pcl.paper_id
                WHERE p.processing_status = 'completed'
            `;
            const params = [];

            // 카테고리 필터
            if (category) {
                sql += ` AND p.primary_category = ?`;
                params.push(category);
            }

            // 코드 유무 필터
            if (hasCode !== null) {
                if (hasCode) {
                    sql += ` AND pcl.id IS NOT NULL`;
                } else {
                    sql += ` AND pcl.id IS NULL`;
                }
            }

            const papers = await query(sql, params);

            // 코사인 유사도 계산 및 정렬
            const results = papers
                .map(paper => {
                    const embedding = this.bufferToVector(paper.embedding_vector);
                    const similarity = this.cosineSimilarity(queryEmbedding, embedding);
                    return {
                        ...paper,
                        similarity,
                        embedding_vector: undefined // 응답에서 제외
                    };
                })
                .filter(paper => paper.similarity >= minScore)
                .sort((a, b) => b.similarity - a.similarity);

            // 페이지네이션
            const offset = (page - 1) * limit;
            const paginatedResults = results.slice(offset, offset + limit);

            return {
                items: paginatedResults.map(paper => ({
                    id: paper.paper_id,
                    arxivId: paper.arxiv_id,
                    title: paper.title_ko || paper.title_en,
                    titleEn: paper.title_en,
                    category: paper.primary_category,
                    publishedDate: paper.published_at,
                    tldr: paper.tldr,
                    hasCode: !!paper.has_code,
                    githubStars: paper.github_stars || 0,
                    githubUrl: paper.github_url,
                    score: Math.round(paper.similarity * 100) / 100
                })),
                pagination: {
                    page,
                    limit,
                    total: results.length,
                    totalPages: Math.ceil(results.length / limit)
                },
                searchType: 'semantic'
            };
        } catch (error) {
            console.error('시맨틱 검색 실패:', error.message);
            // 에러 시 키워드 검색으로 폴백
            return this.fallbackKeywordSearch(queryText, options);
        }
    }

    /**
     * 키워드 검색 폴백
     */
    async fallbackKeywordSearch(queryText, options = {}) {
        const { limit = 20, page = 1, category = null, hasCode = null } = options;
        const offset = (page - 1) * limit;

        let sql = `
            SELECT
                p.id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.primary_category,
                p.published_at,
                ps.tldr,
                pcl.stars as github_stars,
                pcl.repo_url as github_url,
                (pcl.id IS NOT NULL) as has_code,
                MATCH(p.title_en, p.title_ko, p.abstract_en) AGAINST(? IN NATURAL LANGUAGE MODE) as relevance
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            LEFT JOIN paper_code_links pcl ON p.id = pcl.paper_id
            WHERE p.processing_status = 'completed'
              AND MATCH(p.title_en, p.title_ko, p.abstract_en) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        const params = [queryText, queryText];

        if (category) {
            sql += ` AND p.primary_category = ?`;
            params.push(category);
        }

        if (hasCode !== null) {
            if (hasCode) {
                sql += ` AND pcl.id IS NOT NULL`;
            } else {
                sql += ` AND pcl.id IS NULL`;
            }
        }

        sql += ` ORDER BY relevance DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const results = await query(sql, params);

        // 전체 개수 조회
        let countSql = `
            SELECT COUNT(*) as total
            FROM papers p
            LEFT JOIN paper_code_links pcl ON p.id = pcl.paper_id
            WHERE p.processing_status = 'completed'
              AND MATCH(p.title_en, p.title_ko, p.abstract_en) AGAINST(? IN NATURAL LANGUAGE MODE)
        `;
        const countParams = [queryText];

        if (category) {
            countSql += ` AND p.primary_category = ?`;
            countParams.push(category);
        }

        if (hasCode !== null) {
            if (hasCode) {
                countSql += ` AND pcl.id IS NOT NULL`;
            } else {
                countSql += ` AND pcl.id IS NULL`;
            }
        }

        const countResult = await queryOne(countSql, countParams);
        const total = countResult?.total || 0;

        return {
            items: results.map(paper => ({
                id: paper.id,
                arxivId: paper.arxiv_id,
                title: paper.title_ko || paper.title_en,
                titleEn: paper.title_en,
                category: paper.primary_category,
                publishedDate: paper.published_at,
                tldr: paper.tldr,
                hasCode: !!paper.has_code,
                githubStars: paper.github_stars || 0,
                githubUrl: paper.github_url,
                score: paper.relevance
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            },
            searchType: 'keyword',
            note: 'AI 서비스 비활성화로 키워드 검색 사용'
        };
    }

    /**
     * 유사 논문 찾기
     * @param {number} paperId - 기준 논문 ID
     * @param {number} limit - 결과 개수
     */
    async findSimilarPapers(paperId, limit = 5) {
        // 기준 논문 임베딩 가져오기
        const paperEmbedding = await queryOne(
            'SELECT embedding_vector FROM paper_embeddings WHERE paper_id = ?',
            [paperId]
        );

        if (!paperEmbedding || !paperEmbedding.embedding_vector) {
            // 임베딩이 없으면 같은 카테고리 논문 반환
            return this.findSimilarByCategory(paperId, limit);
        }

        const baseVector = this.bufferToVector(paperEmbedding.embedding_vector);

        // 다른 논문 임베딩들과 비교
        const papers = await query(`
            SELECT
                pe.paper_id,
                pe.embedding_vector,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.primary_category,
                ps.tldr
            FROM paper_embeddings pe
            JOIN papers p ON pe.paper_id = p.id
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE pe.paper_id != ? AND p.processing_status = 'completed'
        `, [paperId]);

        // 유사도 계산 및 정렬
        const results = papers
            .map(paper => ({
                id: paper.paper_id,
                arxivId: paper.arxiv_id,
                title: paper.title_ko || paper.title_en,
                category: paper.primary_category,
                tldr: paper.tldr,
                similarity: this.cosineSimilarity(
                    baseVector,
                    this.bufferToVector(paper.embedding_vector)
                )
            }))
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, limit);

        return results;
    }

    /**
     * 카테고리 기반 유사 논문 찾기 (폴백)
     */
    async findSimilarByCategory(paperId, limit = 5) {
        const paper = await queryOne(
            'SELECT primary_category FROM papers WHERE id = ?',
            [paperId]
        );

        if (!paper) return [];

        const results = await query(`
            SELECT
                p.id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.primary_category,
                ps.tldr
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.id != ?
              AND p.primary_category = ?
              AND p.processing_status = 'completed'
            ORDER BY p.published_at DESC
            LIMIT ?
        `, [paperId, paper.primary_category, limit]);

        return results.map(p => ({
            id: p.id,
            arxivId: p.arxiv_id,
            title: p.title_ko || p.title_en,
            category: p.primary_category,
            tldr: p.tldr,
            similarity: null
        }));
    }

    /**
     * 임베딩이 없는 논문 목록 조회
     */
    async getPapersWithoutEmbedding(limit = 100) {
        return query(`
            SELECT p.id, p.title_en, p.abstract_en
            FROM papers p
            LEFT JOIN paper_embeddings pe ON p.id = pe.paper_id
            WHERE pe.id IS NULL AND p.processing_status = 'completed'
            ORDER BY p.created_at DESC
            LIMIT ?
        `, [limit]);
    }

    /**
     * 배치 임베딩 생성
     * @param {number} batchSize - 배치 크기
     */
    async generateBatchEmbeddings(batchSize = 10) {
        const papers = await this.getPapersWithoutEmbedding(batchSize);

        if (papers.length === 0) {
            console.log('모든 논문에 임베딩이 생성되어 있습니다.');
            return { processed: 0, failed: 0 };
        }

        let processed = 0;
        let failed = 0;

        for (const paper of papers) {
            try {
                const text = `${paper.title_en}\n\n${paper.abstract_en || ''}`;
                await this.generateAndSaveEmbedding(paper.id, text);
                processed++;

                // API 레이트 리밋 방지를 위한 딜레이
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                console.error(`논문 ${paper.id} 임베딩 실패:`, error.message);
                failed++;
            }
        }

        return { processed, failed, remaining: await this.getEmbeddingPendingCount() };
    }

    /**
     * 임베딩 대기 논문 수 조회
     */
    async getEmbeddingPendingCount() {
        const result = await queryOne(`
            SELECT COUNT(*) as count
            FROM papers p
            LEFT JOIN paper_embeddings pe ON p.id = pe.paper_id
            WHERE pe.id IS NULL AND p.processing_status = 'completed'
        `);
        return result?.count || 0;
    }

    // ==================== 유틸리티 함수 ====================

    /**
     * Float32 배열을 Buffer로 변환
     */
    vectorToBuffer(vector) {
        const buffer = Buffer.alloc(vector.length * 4);
        for (let i = 0; i < vector.length; i++) {
            buffer.writeFloatLE(vector[i], i * 4);
        }
        return buffer;
    }

    /**
     * Buffer를 Float32 배열로 변환
     */
    bufferToVector(buffer) {
        const vector = [];
        for (let i = 0; i < buffer.length; i += 4) {
            vector.push(buffer.readFloatLE(i));
        }
        return vector;
    }

    /**
     * 코사인 유사도 계산
     */
    cosineSimilarity(vecA, vecB) {
        if (!vecA || !vecB || vecA.length !== vecB.length) {
            return 0;
        }

        let dotProduct = 0;
        let normA = 0;
        let normB = 0;

        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }

        const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
        if (magnitude === 0) return 0;

        return dotProduct / magnitude;
    }
}

// 싱글톤 인스턴스
const semanticSearchService = new SemanticSearchService();

module.exports = semanticSearchService;
