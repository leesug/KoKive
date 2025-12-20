/**
 * KoKive Embedding Processor Job
 * 논문 임베딩 생성 배치 작업 (FR-003 시맨틱 검색)
 */

const cron = require('node-cron');
const semanticSearchService = require('../services/semanticSearchService');
const { query, queryOne } = require('../config/database');

class EmbeddingProcessor {
    constructor() {
        this.isRunning = false;
        this.lastRun = null;
        this.stats = {
            processed: 0,
            failed: 0
        };
    }

    /**
     * 스케줄러 시작
     */
    start() {
        // 기본: 매 2시간마다 실행
        const schedule = process.env.EMBEDDING_PROCESS_SCHEDULE || '0 */2 * * *';

        cron.schedule(schedule, async () => {
            console.log('🔢 임베딩 생성 작업 시작...');
            await this.run();
        });

        console.log(`✅ 임베딩 생성 스케줄러 등록: ${schedule}`);
    }

    /**
     * 배치 처리 실행
     */
    async run() {
        if (this.isRunning) {
            console.log('⚠️  임베딩 생성 작업이 이미 실행 중입니다.');
            return;
        }

        this.isRunning = true;
        this.lastRun = new Date();
        this.resetStats();

        try {
            const batchSize = parseInt(process.env.EMBEDDING_BATCH_SIZE) || 20;
            const result = await semanticSearchService.generateBatchEmbeddings(batchSize);

            this.stats.processed = result.processed;
            this.stats.failed = result.failed;

            this.logStats(result.remaining);

        } catch (error) {
            console.error('❌ 임베딩 생성 배치 오류:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 수동 실행 (관리자용)
     */
    async runManual(batchSize = 10) {
        if (this.isRunning) {
            return {
                success: false,
                message: '이미 실행 중입니다.'
            };
        }

        this.isRunning = true;
        this.resetStats();

        try {
            const result = await semanticSearchService.generateBatchEmbeddings(batchSize);

            this.stats.processed = result.processed;
            this.stats.failed = result.failed;

            return {
                success: true,
                data: result
            };
        } catch (error) {
            return {
                success: false,
                message: error.message
            };
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 특정 논문 임베딩 생성
     */
    async processPaper(paperId) {
        const paper = await queryOne(`
            SELECT id, title_en, abstract_en
            FROM papers
            WHERE id = ? AND processing_status = 'completed'
        `, [paperId]);

        if (!paper) {
            throw new Error('논문을 찾을 수 없습니다.');
        }

        const text = `${paper.title_en}\n\n${paper.abstract_en || ''}`;
        await semanticSearchService.generateAndSaveEmbedding(paperId, text);

        return { success: true };
    }

    /**
     * 통계 초기화
     */
    resetStats() {
        this.stats = {
            processed: 0,
            failed: 0
        };
    }

    /**
     * 통계 로깅
     */
    logStats(remaining = 0) {
        console.log('\n📊 임베딩 생성 결과:');
        console.log(`   처리 완료: ${this.stats.processed}`);
        console.log(`   실패: ${this.stats.failed}`);
        console.log(`   남은 작업: ${remaining}`);
    }

    /**
     * 현재 상태 조회
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastRun: this.lastRun,
            stats: this.stats
        };
    }

    /**
     * 대기열 상태 조회
     */
    async getQueueStatus() {
        const pending = await semanticSearchService.getEmbeddingPendingCount();

        const total = await queryOne(`
            SELECT COUNT(*) as count FROM papers WHERE processing_status = 'completed'
        `);

        const completed = await queryOne(`
            SELECT COUNT(*) as count FROM paper_embeddings
        `);

        return {
            pending,
            completed: completed?.count || 0,
            total: total?.count || 0,
            progress: total?.count > 0
                ? Math.round((completed?.count / total?.count) * 100)
                : 0
        };
    }
}

module.exports = new EmbeddingProcessor();
