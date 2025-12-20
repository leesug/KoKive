/**
 * KoKive AI Processor Job
 * AI 번역/요약 처리 배치 작업 (FR-002)
 */

const cron = require('node-cron');
const aiService = require('../services/aiService');
const semanticSearchService = require('../services/semanticSearchService');
const { query, queryOne, insert, update, transaction } = require('../config/database');
const { PROCESSING_STATUS } = require('../config/constants');

class AIProcessor {
    constructor() {
        this.isRunning = false;
        this.lastRun = null;
        this.currentPaperId = null;
        this.stats = {
            processed: 0,
            failed: 0,
            skipped: 0
        };
        this.concurrency = parseInt(process.env.AI_PROCESS_CONCURRENCY) || 1;
    }

    /**
     * 스케줄러 시작
     */
    start() {
        // 기본: 매시간 실행
        const schedule = process.env.AI_PROCESS_SCHEDULE || '0 * * * *';

        cron.schedule(schedule, async () => {
            console.log('🤖 AI 처리 작업 시작...');
            await this.run();
        });

        console.log(`✅ AI 처리 스케줄러 등록: ${schedule}`);

        // 연속 처리 모드 (옵션)
        if (process.env.AI_CONTINUOUS_PROCESS === 'true') {
            this.startContinuousProcessing();
        }
    }

    /**
     * 연속 처리 모드
     */
    startContinuousProcessing() {
        console.log('🔄 AI 연속 처리 모드 활성화');

        setInterval(async () => {
            if (!this.isRunning) {
                await this.processNext();
            }
        }, 5000); // 5초마다 체크
    }

    /**
     * 배치 처리 실행
     */
    async run() {
        if (this.isRunning) {
            console.log('⚠️  AI 처리 작업이 이미 실행 중입니다.');
            return;
        }

        this.isRunning = true;
        this.lastRun = new Date();
        this.resetStats();

        try {
            const batchSize = parseInt(process.env.AI_BATCH_SIZE) || 10;

            // 대기 중인 작업 조회
            const pendingJobs = await query(`
                SELECT jq.id, jq.payload
                FROM job_queue jq
                WHERE jq.job_type = 'ai_process'
                  AND jq.status = 'pending'
                ORDER BY jq.priority DESC, jq.created_at ASC
                LIMIT ?
            `, [batchSize]);

            console.log(`📋 처리 대기 작업: ${pendingJobs.length}개`);

            for (const job of pendingJobs) {
                try {
                    // payload가 이미 객체인 경우 JSON.parse 건너뛰기
                    const payload = typeof job.payload === 'object' ? job.payload : JSON.parse(job.payload);
                    await this.processJob(job.id, payload);
                } catch (error) {
                    console.error(`❌ 작업 처리 실패 (${job.id}):`, error.message);
                    await this.markJobFailed(job.id, error.message);
                    this.stats.failed++;
                }
            }

            this.logStats();

        } catch (error) {
            console.error('❌ AI 처리 배치 오류:', error);
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 다음 작업 처리 (연속 모드용)
     */
    async processNext() {
        const job = await queryOne(`
            SELECT jq.id, jq.payload
            FROM job_queue jq
            WHERE jq.job_type = 'ai_process'
              AND jq.status = 'pending'
            ORDER BY jq.priority DESC, jq.created_at ASC
            LIMIT 1
        `);

        if (!job) {
            return false;
        }

        this.isRunning = true;

        try {
            // payload가 이미 객체인 경우 JSON.parse 건너뛰기
            const payload = typeof job.payload === 'object' ? job.payload : JSON.parse(job.payload);
            await this.processJob(job.id, payload);
            return true;
        } catch (error) {
            console.error(`❌ 작업 처리 실패 (${job.id}):`, error.message);
            await this.markJobFailed(job.id, error.message);
            return false;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * 단일 작업 처리
     */
    async processJob(jobId, payload) {
        const { paperId, arxivId } = payload;
        this.currentPaperId = paperId;

        console.log(`\n🔬 논문 처리 중: ${arxivId} (ID: ${paperId})`);

        // 작업 시작 표시 - attempts는 raw SQL이 필요하므로 별도 query 사용
        await query(`
            UPDATE job_queue
            SET status = 'processing',
                started_at = NOW(),
                attempts = attempts + 1
            WHERE id = ?
        `, [jobId]);

        // 논문 상태 업데이트
        await update('papers', {
            processing_status: PROCESSING_STATUS.PROCESSING
        }, { id: paperId });

        try {
            // 논문 정보 조회
            const paper = await queryOne(
                'SELECT * FROM papers WHERE id = ?',
                [paperId]
            );

            if (!paper) {
                throw new Error('논문을 찾을 수 없습니다.');
            }

            // AI 서비스 확인
            if (!aiService.isAvailable()) {
                throw new Error('AI 서비스가 초기화되지 않았습니다.');
            }

            // AI 처리 실행
            const result = await aiService.processPaper(paper);

            // 결과 저장
            await this.saveProcessingResult(paperId, paper, result);

            // 작업 완료 표시
            await update('job_queue', {
                status: 'completed',
                completed_at: new Date()
            }, { id: jobId });

            // 논문 상태 완료
            await update('papers', {
                processing_status: PROCESSING_STATUS.COMPLETED,
                title_ko: result.titleKo,
                abstract_ko: result.abstractKo
            }, { id: paperId });

            console.log(`   ✅ 처리 완료 (${result.tokensUsed} tokens, ${result.processingTime}ms)`);
            this.stats.processed++;

        } catch (error) {
            // 실패 처리
            await this.handleProcessingError(jobId, paperId, error);
            throw error;
        } finally {
            this.currentPaperId = null;
        }
    }

    /**
     * 처리 결과 저장
     */
    async saveProcessingResult(paperId, paper, result) {
        const { summary, terms, tokensUsed } = result;

        // 요약 정보 저장
        const existingSummary = await queryOne(
            'SELECT id FROM paper_summaries WHERE paper_id = ?',
            [paperId]
        );

        // summary_3line이 배열이나 객체인 경우 문자열로 변환
        let summary3line = summary.summary_3line;
        if (Array.isArray(summary3line)) {
            summary3line = summary3line.join('\n');
        } else if (summary3line && typeof summary3line === 'object') {
            summary3line = JSON.stringify(summary3line);
        }

        const summaryData = {
            paper_id: paperId,
            tldr: summary.tldr,
            one_line_summary: summary.one_line_summary,
            summary_3line: summary3line,
            summary_detailed: summary.summary_detailed,
            business_insight: summary.business_insight,
            shorts_script: summary.shorts_script ? JSON.stringify(summary.shorts_script) : null
        };

        if (existingSummary) {
            await update('paper_summaries', summaryData, { id: existingSummary.id });
        } else {
            await insert('paper_summaries', summaryData);
        }

        // 용어 연결 저장
        if (terms && terms.length > 0) {
            await this.saveTerms(paperId, terms);
        }

        // 임베딩 생성 및 저장 (시맨틱 검색용) - semanticSearchService 사용
        try {
            const embeddingText = `${result.titleKo}\n\n${summary.tldr}\n\n${summary.summary_detailed}`;
            await semanticSearchService.generateAndSaveEmbedding(paperId, embeddingText);
        } catch (error) {
            console.log(`   ⚠️  임베딩 생성 실패: ${error.message}`);
        }
    }

    /**
     * 용어 저장 및 연결
     */
    async saveTerms(paperId, terms) {
        for (const term of terms) {
            try {
                // 기존 용어 확인
                let termRecord = await queryOne(
                    'SELECT id FROM terms WHERE term_en = ?',
                    [term.term_en]
                );

                // 없으면 새로 생성
                if (!termRecord) {
                    const termId = await insert('terms', {
                        term_en: term.term_en,
                        term_ko: term.term_ko,
                        definition_ko: term.definition,
                        category: 'auto_extracted'
                    });
                    termRecord = { id: termId };
                }

                // 논문-용어 연결 (중복 무시)
                try {
                    await insert('paper_terms', {
                        paper_id: paperId,
                        term_id: termRecord.id
                    });
                } catch (err) {
                    // 중복 연결은 무시
                }
            } catch (error) {
                console.log(`   ⚠️  용어 저장 실패 (${term.term_en}): ${error.message}`);
            }
        }
    }

    /**
     * 처리 오류 핸들링
     */
    async handleProcessingError(jobId, paperId, error) {
        const job = await queryOne('SELECT attempts, max_attempts FROM job_queue WHERE id = ?', [jobId]);

        if (job && job.attempts >= job.max_attempts) {
            // 최대 재시도 초과
            await update('job_queue', {
                status: 'failed',
                error_message: error.message
            }, { id: jobId });

            await update('papers', {
                processing_status: PROCESSING_STATUS.FAILED
            }, { id: paperId });

            console.log(`   ❌ 최대 재시도 초과, 실패 처리`);
        } else {
            // 재시도 대기
            await update('job_queue', {
                status: 'pending',
                error_message: error.message,
                scheduled_at: new Date(Date.now() + 60000 * (job?.attempts || 1)) // 재시도 간격 증가
            }, { id: jobId });

            await update('papers', {
                processing_status: PROCESSING_STATUS.PENDING
            }, { id: paperId });

            console.log(`   ⚠️  재시도 예약됨 (시도: ${job?.attempts || 1}/${job?.max_attempts || 3})`);
        }
    }

    /**
     * 작업 실패 표시
     */
    async markJobFailed(jobId, errorMessage) {
        await update('job_queue', {
            status: 'failed',
            error_message: errorMessage
        }, { id: jobId });
    }

    /**
     * 특정 논문 수동 처리
     */
    async processPaper(paperId) {
        const paper = await queryOne('SELECT * FROM papers WHERE id = ?', [paperId]);

        if (!paper) {
            throw new Error('논문을 찾을 수 없습니다.');
        }

        if (!aiService.isAvailable()) {
            throw new Error('AI 서비스가 초기화되지 않았습니다.');
        }

        // 상태 업데이트
        await update('papers', {
            processing_status: PROCESSING_STATUS.PROCESSING
        }, { id: paperId });

        try {
            const result = await aiService.processPaper(paper);
            await this.saveProcessingResult(paperId, paper, result);

            await update('papers', {
                processing_status: PROCESSING_STATUS.COMPLETED,
                title_ko: result.titleKo,
                abstract_ko: result.abstractKo
            }, { id: paperId });

            return { success: true, result };
        } catch (error) {
            await update('papers', {
                processing_status: PROCESSING_STATUS.FAILED
            }, { id: paperId });

            return { success: false, error: error.message };
        }
    }

    /**
     * 실패한 논문 재처리
     */
    async retryFailed(limit = 10) {
        const failedPapers = await query(`
            SELECT id, arxiv_id FROM papers
            WHERE processing_status = 'failed'
            ORDER BY updated_at ASC
            LIMIT ?
        `, [limit]);

        const results = [];

        for (const paper of failedPapers) {
            const result = await this.processPaper(paper.id);
            results.push({
                paperId: paper.id,
                arxivId: paper.arxiv_id,
                ...result
            });
        }

        return results;
    }

    /**
     * 통계 초기화
     */
    resetStats() {
        this.stats = {
            processed: 0,
            failed: 0,
            skipped: 0
        };
    }

    /**
     * 통계 로깅
     */
    logStats() {
        console.log('\n📊 AI 처리 결과:');
        console.log(`   처리 완료: ${this.stats.processed}`);
        console.log(`   실패: ${this.stats.failed}`);
        console.log(`   스킵: ${this.stats.skipped}`);
    }

    /**
     * 현재 상태 조회
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            lastRun: this.lastRun,
            currentPaperId: this.currentPaperId,
            stats: this.stats,
            aiServiceAvailable: aiService.isAvailable()
        };
    }

    /**
     * 대기열 상태 조회
     */
    async getQueueStatus() {
        const stats = await queryOne(`
            SELECT
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
            FROM job_queue
            WHERE job_type = 'ai_process'
        `);

        return {
            pending: stats.pending || 0,
            processing: stats.processing || 0,
            completed: stats.completed || 0,
            failed: stats.failed || 0
        };
    }

    /**
     * 불완전한 논문 찾기 (요약, 번역, 쉬운해설 누락)
     * @param {number} limit - 최대 조회 수
     * @returns {Promise<Array>} 불완전한 논문 목록
     */
    async findIncompletePapers(limit = 100) {
        const papers = await query(`
            SELECT
                p.id,
                p.arxiv_id,
                p.title_en,
                p.title_ko,
                p.abstract_ko,
                p.processing_status,
                p.created_at,
                ps.id as summary_id,
                ps.tldr,
                ps.one_line_summary,
                ps.summary_3line,
                ps.summary_detailed,
                ps.business_insight
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.processing_status = 'completed'
              AND (
                  p.title_ko IS NULL OR p.title_ko = ''
                  OR p.abstract_ko IS NULL OR p.abstract_ko = ''
                  OR ps.id IS NULL
                  OR ps.tldr IS NULL OR ps.tldr = ''
                  OR ps.one_line_summary IS NULL OR ps.one_line_summary = ''
                  OR ps.summary_3line IS NULL OR ps.summary_3line = ''
                  OR ps.summary_detailed IS NULL OR ps.summary_detailed = ''
              )
            ORDER BY p.created_at DESC
            LIMIT ?
        `, [limit]);

        return papers.map(paper => ({
            id: paper.id,
            arxivId: paper.arxiv_id,
            title: paper.title_en,
            createdAt: paper.created_at,
            missing: {
                titleKo: !paper.title_ko,
                abstractKo: !paper.abstract_ko,
                summary: !paper.summary_id,
                tldr: !paper.tldr,
                oneLineSummary: !paper.one_line_summary,
                summary3line: !paper.summary_3line,
                summaryDetailed: !paper.summary_detailed
            }
        }));
    }

    /**
     * 불완전한 논문 통계 조회
     * @returns {Promise<Object>} 누락 항목별 통계
     */
    async getIncompleteStats() {
        const stats = await queryOne(`
            SELECT
                COUNT(*) as total_completed,
                SUM(CASE WHEN p.title_ko IS NULL OR p.title_ko = '' THEN 1 ELSE 0 END) as missing_title_ko,
                SUM(CASE WHEN p.abstract_ko IS NULL OR p.abstract_ko = '' THEN 1 ELSE 0 END) as missing_abstract_ko,
                SUM(CASE WHEN ps.id IS NULL THEN 1 ELSE 0 END) as missing_summary_record,
                SUM(CASE WHEN ps.tldr IS NULL OR ps.tldr = '' THEN 1 ELSE 0 END) as missing_tldr,
                SUM(CASE WHEN ps.one_line_summary IS NULL OR ps.one_line_summary = '' THEN 1 ELSE 0 END) as missing_one_line,
                SUM(CASE WHEN ps.summary_3line IS NULL OR ps.summary_3line = '' THEN 1 ELSE 0 END) as missing_3line,
                SUM(CASE WHEN ps.summary_detailed IS NULL OR ps.summary_detailed = '' THEN 1 ELSE 0 END) as missing_detailed
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.processing_status = 'completed'
        `);

        // 하나라도 누락된 논문 수
        const incompleteCount = await queryOne(`
            SELECT COUNT(*) as count
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.processing_status = 'completed'
              AND (
                  p.title_ko IS NULL OR p.title_ko = ''
                  OR p.abstract_ko IS NULL OR p.abstract_ko = ''
                  OR ps.id IS NULL
                  OR ps.tldr IS NULL OR ps.tldr = ''
                  OR ps.one_line_summary IS NULL OR ps.one_line_summary = ''
                  OR ps.summary_3line IS NULL OR ps.summary_3line = ''
                  OR ps.summary_detailed IS NULL OR ps.summary_detailed = ''
              )
        `);

        return {
            totalCompleted: stats.total_completed || 0,
            incompleteCount: incompleteCount.count || 0,
            missingTitleKo: stats.missing_title_ko || 0,
            missingAbstractKo: stats.missing_abstract_ko || 0,
            missingSummaryRecord: stats.missing_summary_record || 0,
            missingTldr: stats.missing_tldr || 0,
            missingOneLine: stats.missing_one_line || 0,
            missing3line: stats.missing_3line || 0,
            missingDetailed: stats.missing_detailed || 0
        };
    }

    /**
     * 불완전한 논문 일괄 재처리
     * @param {number} limit - 최대 처리 수
     * @returns {Promise<Object>} 처리 결과
     */
    async reprocessIncompletePapers(limit = 10) {
        const incompletePapers = await this.findIncompletePapers(limit);

        console.log(`🔄 불완전한 논문 재처리 시작: ${incompletePapers.length}개`);

        const results = {
            total: incompletePapers.length,
            success: 0,
            failed: 0,
            totalCost: 0,
            details: []
        };

        for (const paper of incompletePapers) {
            // 재처리 로그 기록 시작
            const logId = await this.logReprocessStart(paper.id, 'incomplete', paper.missing);

            try {
                console.log(`   📝 재처리 중: ${paper.arxivId} (ID: ${paper.id})`);
                const result = await this.processPaper(paper.id);

                if (result.success) {
                    results.success++;
                    const cost = result.cost || 0;
                    results.totalCost += cost;
                    results.details.push({
                        id: paper.id,
                        arxivId: paper.arxivId,
                        status: 'success',
                        cost: cost
                    });
                    await this.logReprocessComplete(logId, 'completed', result);
                    console.log(`   ✅ 성공: ${paper.arxivId} (비용: $${cost.toFixed(4)})`);
                } else {
                    results.failed++;
                    results.details.push({
                        id: paper.id,
                        arxivId: paper.arxivId,
                        status: 'failed',
                        error: result.error
                    });
                    await this.logReprocessComplete(logId, 'failed', result);
                    console.log(`   ❌ 실패: ${paper.arxivId} - ${result.error}`);
                }
            } catch (error) {
                results.failed++;
                results.details.push({
                    id: paper.id,
                    arxivId: paper.arxivId,
                    status: 'error',
                    error: error.message
                });
                await this.logReprocessComplete(logId, 'failed', { error: error.message });
                console.log(`   ❌ 에러: ${paper.arxivId} - ${error.message}`);
            }
        }

        console.log(`\n📊 재처리 완료: 성공 ${results.success}, 실패 ${results.failed}, 총 비용: $${results.totalCost.toFixed(4)}`);
        return results;
    }

    /**
     * 재처리 로그 시작 기록
     */
    async logReprocessStart(paperId, reason, missingFields) {
        try {
            const result = await insert('paper_reprocess_logs', {
                paper_id: paperId,
                reason: reason,
                missing_fields: JSON.stringify(missingFields || {}),
                status: 'processing'
            });
            return result.insertId;
        } catch (error) {
            console.error('재처리 로그 시작 기록 실패:', error.message);
            return null;
        }
    }

    /**
     * 재처리 로그 완료 기록
     */
    async logReprocessComplete(logId, status, result) {
        if (!logId) return;

        try {
            await update('paper_reprocess_logs', {
                status: status,
                input_tokens: result.inputTokens || 0,
                output_tokens: result.outputTokens || 0,
                cost_usd: result.cost || 0,
                error_message: result.error || null,
                completed_at: new Date()
            }, { id: logId });

            // papers 테이블의 재처리 횟수 업데이트
            if (status === 'completed' && result.paperId) {
                await query(`
                    UPDATE papers
                    SET reprocess_count = COALESCE(reprocess_count, 0) + 1,
                        last_reprocessed_at = NOW()
                    WHERE id = ?
                `, [result.paperId]);
            }
        } catch (error) {
            console.error('재처리 로그 완료 기록 실패:', error.message);
        }
    }

    /**
     * 재처리 통계 조회
     */
    async getReprocessStats() {
        try {
            // 전체 통계
            const totalStats = await queryOne(`
                SELECT
                    COUNT(*) as total_reprocesses,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(COALESCE(cost_usd, 0)) as total_cost,
                    SUM(COALESCE(input_tokens, 0)) as total_input_tokens,
                    SUM(COALESCE(output_tokens, 0)) as total_output_tokens
                FROM paper_reprocess_logs
            `);

            // 이번 달 통계
            const monthlyStats = await queryOne(`
                SELECT
                    COUNT(*) as total_reprocesses,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(COALESCE(cost_usd, 0)) as total_cost
                FROM paper_reprocess_logs
                WHERE created_at >= DATE_FORMAT(NOW(), '%Y-%m-01')
            `);

            // 사유별 통계
            const byReason = await query(`
                SELECT
                    reason,
                    COUNT(*) as count,
                    SUM(COALESCE(cost_usd, 0)) as total_cost
                FROM paper_reprocess_logs
                GROUP BY reason
            `);

            // 최근 7일간 일별 통계
            const daily = await query(`
                SELECT
                    DATE(created_at) as date,
                    COUNT(*) as count,
                    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                    SUM(COALESCE(cost_usd, 0)) as cost
                FROM paper_reprocess_logs
                WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                GROUP BY DATE(created_at)
                ORDER BY date DESC
            `);

            // 최근 재처리 로그
            const recentLogs = await query(`
                SELECT
                    prl.id,
                    prl.paper_id,
                    p.arxiv_id,
                    p.title_en,
                    prl.reason,
                    prl.status,
                    prl.cost_usd,
                    prl.missing_fields,
                    prl.error_message,
                    prl.created_at,
                    prl.completed_at
                FROM paper_reprocess_logs prl
                JOIN papers p ON prl.paper_id = p.id
                ORDER BY prl.created_at DESC
                LIMIT 20
            `);

            return {
                total: {
                    reprocesses: totalStats.total_reprocesses || 0,
                    completed: totalStats.completed || 0,
                    failed: totalStats.failed || 0,
                    costUsd: parseFloat(totalStats.total_cost) || 0,
                    inputTokens: totalStats.total_input_tokens || 0,
                    outputTokens: totalStats.total_output_tokens || 0
                },
                monthly: {
                    reprocesses: monthlyStats.total_reprocesses || 0,
                    completed: monthlyStats.completed || 0,
                    failed: monthlyStats.failed || 0,
                    costUsd: parseFloat(monthlyStats.total_cost) || 0
                },
                byReason: byReason.map(r => ({
                    reason: r.reason,
                    count: r.count,
                    costUsd: parseFloat(r.total_cost) || 0
                })),
                daily: daily.map(d => ({
                    date: d.date,
                    count: d.count,
                    completed: d.completed,
                    costUsd: parseFloat(d.cost) || 0
                })),
                recentLogs: recentLogs.map(log => ({
                    id: log.id,
                    paperId: log.paper_id,
                    arxivId: log.arxiv_id,
                    title: log.title_en,
                    reason: log.reason,
                    status: log.status,
                    costUsd: parseFloat(log.cost_usd) || 0,
                    missingFields: log.missing_fields ? JSON.parse(log.missing_fields) : {},
                    errorMessage: log.error_message,
                    createdAt: log.created_at,
                    completedAt: log.completed_at
                }))
            };
        } catch (error) {
            console.error('재처리 통계 조회 실패:', error.message);
            return {
                total: { reprocesses: 0, completed: 0, failed: 0, costUsd: 0 },
                monthly: { reprocesses: 0, completed: 0, failed: 0, costUsd: 0 },
                byReason: [],
                daily: [],
                recentLogs: []
            };
        }
    }

    /**
     * 단일 논문 재처리 (ID로)
     * @param {number} paperId - 논문 ID
     * @returns {Promise<Object>} 처리 결과
     */
    async reprocessPaperById(paperId) {
        const paper = await queryOne(`
            SELECT
                p.id,
                p.arxiv_id,
                p.title_en,
                ps.tldr,
                ps.summary_detailed
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.id = ?
        `, [paperId]);

        if (!paper) {
            return { success: false, error: '논문을 찾을 수 없습니다.' };
        }

        console.log(`🔄 논문 재처리: ${paper.arxiv_id} (ID: ${paperId})`);
        return await this.processPaper(paperId);
    }

    /**
     * 최소비용 선택적 재처리 (누락된 필드만 처리)
     * API 비용을 최소화하기 위해 이미 있는 데이터는 유지하고 누락된 필드만 생성
     * @param {number} paperId - 논문 ID
     * @returns {Promise<Object>} 처리 결과
     */
    async reprocessMissingFieldsOnly(paperId) {
        const paper = await queryOne(`
            SELECT
                p.*,
                ps.id as summary_id,
                ps.tldr,
                ps.one_line_summary,
                ps.summary_3line,
                ps.summary_detailed,
                ps.business_insight
            FROM papers p
            LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
            WHERE p.id = ?
        `, [paperId]);

        if (!paper) {
            return { success: false, error: '논문을 찾을 수 없습니다.', cost: 0 };
        }

        // 누락된 필드 확인
        const missingFields = {
            titleKo: !paper.title_ko || paper.title_ko.trim() === '',
            abstractKo: !paper.abstract_ko || paper.abstract_ko.trim() === '',
            tldr: !paper.tldr || paper.tldr.trim() === '',
            oneLine: !paper.one_line_summary || paper.one_line_summary.trim() === '',
            summary3line: !paper.summary_3line || paper.summary_3line.trim() === '',
            summaryDetailed: !paper.summary_detailed || paper.summary_detailed.trim() === ''
        };

        const hasMissing = Object.values(missingFields).some(v => v);

        if (!hasMissing) {
            console.log(`✅ 논문 ${paper.arxiv_id}: 모든 필드가 완전함, 재처리 불필요`);
            return { success: true, skipped: true, cost: 0, message: '모든 필드가 완전합니다.' };
        }

        // 로그 기록 시작
        const logId = await this.logReprocessStart(paperId, 'manual', missingFields);
        const startTime = Date.now();

        try {
            console.log(`🔄 선택적 재처리 시작: ${paper.arxiv_id}`);
            console.log(`   누락 필드: ${Object.entries(missingFields).filter(([k, v]) => v).map(([k]) => k).join(', ')}`);

            // AI 서비스로 처리
            if (!aiService.isAvailable()) {
                throw new Error('AI 서비스가 초기화되지 않았습니다.');
            }

            const result = await aiService.processPaper(paper);
            const processingTime = Date.now() - startTime;

            // 누락된 필드만 업데이트
            const paperUpdates = {};
            if (missingFields.titleKo && result.titleKo) {
                paperUpdates.title_ko = result.titleKo;
            }
            if (missingFields.abstractKo && result.abstractKo) {
                paperUpdates.abstract_ko = result.abstractKo;
            }

            if (Object.keys(paperUpdates).length > 0) {
                await update('papers', paperUpdates, { id: paperId });
            }

            // 요약 테이블 업데이트 (누락된 필드만)
            const summaryUpdates = {};
            if (missingFields.tldr && result.summary.tldr) {
                summaryUpdates.tldr = result.summary.tldr;
            }
            if (missingFields.oneLine && result.summary.one_line_summary) {
                summaryUpdates.one_line_summary = result.summary.one_line_summary;
            }
            if (missingFields.summary3line && result.summary.summary_3line) {
                summaryUpdates.summary_3line = result.summary.summary_3line;
            }
            if (missingFields.summaryDetailed && result.summary.summary_detailed) {
                summaryUpdates.summary_detailed = result.summary.summary_detailed;
            }

            if (Object.keys(summaryUpdates).length > 0) {
                // summary_3line이 배열이면 문자열로 변환
                if (summaryUpdates.summary_3line && Array.isArray(summaryUpdates.summary_3line)) {
                    summaryUpdates.summary_3line = summaryUpdates.summary_3line.join('\n');
                } else if (summaryUpdates.summary_3line && typeof summaryUpdates.summary_3line === 'object') {
                    summaryUpdates.summary_3line = JSON.stringify(summaryUpdates.summary_3line);
                }

                if (paper.summary_id) {
                    await update('paper_summaries', summaryUpdates, { id: paper.summary_id });
                } else {
                    // summary_3line 변환
                    let summary3line = result.summary.summary_3line;
                    if (Array.isArray(summary3line)) {
                        summary3line = summary3line.join('\n');
                    } else if (summary3line && typeof summary3line === 'object') {
                        summary3line = JSON.stringify(summary3line);
                    }

                    // 새 레코드 INSERT 시 모든 summary 필드 포함
                    const fullSummaryData = {
                        paper_id: paperId,
                        tldr: result.summary.tldr || null,
                        one_line_summary: result.summary.one_line_summary || null,
                        summary_3line: summary3line || null,
                        summary_detailed: result.summary.summary_detailed || null,
                        business_insight: result.summary.business_insight || null,
                        shorts_script: result.summary.shorts_script ? JSON.stringify(result.summary.shorts_script) : null
                    };
                    await insert('paper_summaries', fullSummaryData);
                }
            }

            // 비용 추정
            const estimatedCost = aiService.calculateCost(
                Math.floor(result.tokensUsed * 0.67),
                Math.floor(result.tokensUsed * 0.33),
                'haiku'
            );

            // 로그 완료
            await this.logReprocessComplete(logId, 'completed', {
                paperId: paperId,
                inputTokens: Math.floor(result.tokensUsed * 0.67),
                outputTokens: Math.floor(result.tokensUsed * 0.33),
                cost: estimatedCost
            });

            // papers 테이블의 재처리 횟수 업데이트
            await query(`
                UPDATE papers
                SET reprocess_count = COALESCE(reprocess_count, 0) + 1,
                    last_reprocessed_at = NOW()
                WHERE id = ?
            `, [paperId]);

            console.log(`✅ 선택적 재처리 완료: ${paper.arxiv_id} ($${estimatedCost.toFixed(4)}, ${processingTime}ms)`);

            return {
                success: true,
                paperId: paperId,
                arxivId: paper.arxiv_id,
                missingFields: missingFields,
                updatedFields: {
                    paper: Object.keys(paperUpdates),
                    summary: Object.keys(summaryUpdates)
                },
                tokensUsed: result.tokensUsed,
                cost: estimatedCost,
                processingTime: processingTime
            };

        } catch (error) {
            await this.logReprocessComplete(logId, 'failed', { error: error.message });
            console.error(`❌ 선택적 재처리 실패: ${paper.arxiv_id} - ${error.message}`);
            return { success: false, error: error.message, cost: 0 };
        }
    }

    /**
     * 최소비용 일괄 재처리 (누락된 필드만)
     * @param {number} limit - 최대 처리 수
     * @returns {Promise<Object>} 처리 결과
     */
    async reprocessMinimalCost(limit = 10) {
        const incompletePapers = await this.findIncompletePapers(limit);

        console.log(`💰 최소비용 재처리 시작: ${incompletePapers.length}개`);

        const results = {
            total: incompletePapers.length,
            success: 0,
            skipped: 0,
            failed: 0,
            totalCost: 0,
            totalTokens: 0,
            details: []
        };

        for (const paper of incompletePapers) {
            try {
                const result = await this.reprocessMissingFieldsOnly(paper.id);

                if (result.skipped) {
                    results.skipped++;
                } else if (result.success) {
                    results.success++;
                    results.totalCost += result.cost || 0;
                    results.totalTokens += result.tokensUsed || 0;
                } else {
                    results.failed++;
                }

                results.details.push({
                    id: paper.id,
                    arxivId: paper.arxivId,
                    status: result.skipped ? 'skipped' : (result.success ? 'success' : 'failed'),
                    cost: result.cost || 0,
                    tokens: result.tokensUsed || 0,
                    error: result.error
                });

            } catch (error) {
                results.failed++;
                results.details.push({
                    id: paper.id,
                    arxivId: paper.arxivId,
                    status: 'error',
                    cost: 0,
                    error: error.message
                });
            }
        }

        console.log(`\n📊 최소비용 재처리 완료:`);
        console.log(`   성공: ${results.success}, 스킵: ${results.skipped}, 실패: ${results.failed}`);
        console.log(`   총 비용: $${results.totalCost.toFixed(4)}, 총 토큰: ${results.totalTokens}`);

        return results;
    }

    /**
     * 논문 수집 후 검증 및 자동 재처리
     * 수집 완료된 논문들의 AI 처리 결과를 검증하고 누락된 항목이 있으면 재처리
     * @param {Array} paperIds - 검증할 논문 ID 목록 (없으면 최근 수집된 논문)
     * @returns {Promise<Object>} 검증 및 재처리 결과
     */
    async validateAndReprocessAfterCollect(paperIds = null) {
        let papers;

        if (paperIds && paperIds.length > 0) {
            // 특정 논문들 검증
            papers = await query(`
                SELECT
                    p.id,
                    p.arxiv_id,
                    p.title_ko,
                    p.abstract_ko,
                    ps.tldr,
                    ps.one_line_summary,
                    ps.summary_3line,
                    ps.summary_detailed
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.id IN (?)
                  AND p.processing_status = 'completed'
            `, [paperIds]);
        } else {
            // 최근 24시간 내 수집된 논문 검증
            papers = await query(`
                SELECT
                    p.id,
                    p.arxiv_id,
                    p.title_ko,
                    p.abstract_ko,
                    ps.tldr,
                    ps.one_line_summary,
                    ps.summary_3line,
                    ps.summary_detailed
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.processing_status = 'completed'
                  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
            `);
        }

        console.log(`🔍 논문 검증 시작: ${papers.length}개`);

        const results = {
            total: papers.length,
            complete: 0,
            incomplete: 0,
            reprocessed: 0,
            reprocessFailed: 0,
            details: []
        };

        for (const paper of papers) {
            const isComplete =
                paper.title_ko && paper.title_ko.trim() !== '' &&
                paper.abstract_ko && paper.abstract_ko.trim() !== '' &&
                paper.tldr && paper.tldr.trim() !== '' &&
                paper.one_line_summary && paper.one_line_summary.trim() !== '' &&
                paper.summary_3line && paper.summary_3line.trim() !== '' &&
                paper.summary_detailed && paper.summary_detailed.trim() !== '';

            if (isComplete) {
                results.complete++;
                continue;
            }

            results.incomplete++;
            console.log(`   ⚠️  불완전한 논문 발견: ${paper.arxiv_id} (ID: ${paper.id})`);

            // 자동 재처리
            try {
                const reprocessResult = await this.processPaper(paper.id);

                if (reprocessResult.success) {
                    results.reprocessed++;
                    results.details.push({
                        id: paper.id,
                        arxivId: paper.arxiv_id,
                        action: 'reprocessed',
                        status: 'success'
                    });
                    console.log(`   ✅ 재처리 성공: ${paper.arxiv_id}`);
                } else {
                    results.reprocessFailed++;
                    results.details.push({
                        id: paper.id,
                        arxivId: paper.arxiv_id,
                        action: 'reprocessed',
                        status: 'failed',
                        error: reprocessResult.error
                    });
                    console.log(`   ❌ 재처리 실패: ${paper.arxiv_id}`);
                }
            } catch (error) {
                results.reprocessFailed++;
                results.details.push({
                    id: paper.id,
                    arxivId: paper.arxiv_id,
                    action: 'reprocessed',
                    status: 'error',
                    error: error.message
                });
                console.log(`   ❌ 재처리 에러: ${paper.arxiv_id} - ${error.message}`);
            }
        }

        console.log(`\n📊 검증 완료: 완전 ${results.complete}, 불완전 ${results.incomplete}, 재처리 성공 ${results.reprocessed}, 재처리 실패 ${results.reprocessFailed}`);
        return results;
    }
}

module.exports = new AIProcessor();
