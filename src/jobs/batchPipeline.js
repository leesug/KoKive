/**
 * KoKive Batch Pipeline Scheduler
 * 배치 작업 파이프라인 자동화
 *
 * 파이프라인 순서:
 * 1. 논문 수집 (Paper Collection) - 설정된 시간에 실행
 * 2. 불완전한 논문 검증 (Incomplete Paper Validation) - 논문 수집 2시간 후
 * 3. 쇼츠 자동 생성 (Shorts Auto-generation) - 검증 완료 후
 * 4. 쇼츠 자동 배포 (Shorts Auto-deployment) - 생성 완료 후
 */

const { query, queryOne, insert, update } = require('../config/database');
const paperCollector = require('./paperCollector');
const aiProcessor = require('./aiProcessor');

class BatchPipeline {
    constructor() {
        this.isRunning = false;
        this.currentStage = null;
        this.pipelineInterval = null;
        this.lastPipelineRun = null;

        // 파이프라인 설정
        this.config = {
            enabled: false,
            validationDelayHours: 2,     // 논문 수집 후 검증까지 대기 시간
            shortsGenerationDelay: 0.5,   // 검증 후 쇼츠 생성까지 대기 시간 (시간)
            shortsDeployDelay: 0.5,       // 쇼츠 생성 후 배포까지 대기 시간 (시간)
            maxShortsPerBatch: 5,         // 배치당 최대 쇼츠 생성 수
            autoDeploy: false             // 자동 배포 활성화 여부
        };

        // 파이프라인 상태
        this.status = {
            stage1_paperCollect: { status: 'idle', lastRun: null, nextRun: null },
            stage2_validation: { status: 'idle', lastRun: null, nextRun: null },
            stage3_shortsGen: { status: 'idle', lastRun: null, nextRun: null },
            stage4_shortsDeploy: { status: 'idle', lastRun: null, nextRun: null },
            stage5_newsletter: { status: 'idle', lastRun: null, nextRun: null }
        };

        // 로그
        this.logs = [];
    }

    /**
     * 파이프라인 스케줄러 시작
     */
    start() {
        console.log('✅ 배치 파이프라인 스케줄러 시작');

        // 설정 로드
        this.loadConfig();

        // 매분 파이프라인 상태 체크
        this.pipelineInterval = setInterval(() => {
            this.checkPipelineSchedule();
        }, 60 * 1000);

        // 시작 시 한번 체크
        this.checkPipelineSchedule();
    }

    /**
     * 파이프라인 스케줄러 중지
     */
    stop() {
        if (this.pipelineInterval) {
            clearInterval(this.pipelineInterval);
            this.pipelineInterval = null;
            console.log('⏹️ 배치 파이프라인 스케줄러 중지됨');
        }
    }

    /**
     * 로그 추가
     */
    addLog(type, stage, message) {
        const logEntry = {
            time: new Date().toISOString(),
            type,
            stage,
            message
        };
        this.logs.push(logEntry);
        if (this.logs.length > 100) {
            this.logs.shift();
        }
        const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : '📋';
        console.log(`${prefix} [Pipeline/${stage}] ${message}`);
    }

    /**
     * DB에서 설정 로드
     */
    async loadConfig() {
        try {
            const setting = await queryOne(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'batch_pipeline_config'"
            );
            if (setting && setting.setting_value) {
                const savedConfig = JSON.parse(setting.setting_value);
                this.config = { ...this.config, ...savedConfig };
                console.log('📅 파이프라인 설정 로드됨:', this.config);
            }
        } catch (error) {
            console.error('파이프라인 설정 로드 실패:', error.message);
        }
    }

    /**
     * 설정 저장
     */
    async saveConfig(newConfig) {
        try {
            this.config = { ...this.config, ...newConfig };
            const configJson = JSON.stringify(this.config);

            const existing = await queryOne(
                "SELECT id FROM system_settings WHERE setting_key = 'batch_pipeline_config'"
            );

            if (existing) {
                await update('system_settings',
                    { setting_value: configJson },
                    { setting_key: 'batch_pipeline_config' }
                );
            } else {
                await insert('system_settings', {
                    setting_key: 'batch_pipeline_config',
                    setting_value: configJson,
                    description: '배치 파이프라인 설정'
                });
            }

            return { success: true };
        } catch (error) {
            console.error('파이프라인 설정 저장 실패:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * 파이프라인 스케줄 체크 및 실행
     */
    async checkPipelineSchedule() {
        if (!this.config.enabled) return;

        try {
            // 파이프라인 상태 DB에서 로드
            const pipelineState = await this.loadPipelineState();

            const now = new Date();

            // Stage 2: 논문 검증 - 논문 수집 완료 후 설정된 시간 후에 실행
            if (pipelineState.stage1CompletedAt) {
                const validationTime = new Date(pipelineState.stage1CompletedAt);
                validationTime.setHours(validationTime.getHours() + this.config.validationDelayHours);

                if (now >= validationTime && !pipelineState.stage2CompletedAt) {
                    if (this.status.stage2_validation.status !== 'running') {
                        this.runStage2Validation();
                    }
                }
            }

            // Stage 3: 쇼츠 생성 - 검증 완료 후 설정된 시간 후에 실행
            if (pipelineState.stage2CompletedAt) {
                const shortsGenTime = new Date(pipelineState.stage2CompletedAt);
                shortsGenTime.setMinutes(shortsGenTime.getMinutes() + this.config.shortsGenerationDelay * 60);

                if (now >= shortsGenTime && !pipelineState.stage3CompletedAt) {
                    if (this.status.stage3_shortsGen.status !== 'running') {
                        this.runStage3ShortsGeneration();
                    }
                }
            }

            // Stage 4: 쇼츠 배포 - 생성 완료 후 설정된 시간 후에 실행 (자동 배포가 활성화된 경우만)
            if (this.config.autoDeploy && pipelineState.stage3CompletedAt) {
                const deployTime = new Date(pipelineState.stage3CompletedAt);
                deployTime.setMinutes(deployTime.getMinutes() + this.config.shortsDeployDelay * 60);

                if (now >= deployTime && !pipelineState.stage4CompletedAt) {
                    if (this.status.stage4_shortsDeploy.status !== 'running') {
                        this.runStage4ShortsDeploy();
                    }
                }
            }

        } catch (error) {
            console.error('파이프라인 스케줄 체크 오류:', error.message);
        }
    }

    /**
     * 파이프라인 상태 로드
     */
    async loadPipelineState() {
        try {
            const state = await queryOne(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'batch_pipeline_state'"
            );
            if (state && state.setting_value) {
                return JSON.parse(state.setting_value);
            }
        } catch (error) {
            console.error('파이프라인 상태 로드 실패:', error.message);
        }
        return {};
    }

    /**
     * 파이프라인 상태 저장
     */
    async savePipelineState(updates) {
        try {
            const currentState = await this.loadPipelineState();
            const newState = { ...currentState, ...updates };
            const stateJson = JSON.stringify(newState);

            const existing = await queryOne(
                "SELECT id FROM system_settings WHERE setting_key = 'batch_pipeline_state'"
            );

            if (existing) {
                await update('system_settings',
                    { setting_value: stateJson },
                    { setting_key: 'batch_pipeline_state' }
                );
            } else {
                await insert('system_settings', {
                    setting_key: 'batch_pipeline_state',
                    setting_value: stateJson,
                    description: '배치 파이프라인 상태'
                });
            }
        } catch (error) {
            console.error('파이프라인 상태 저장 실패:', error.message);
        }
    }

    /**
     * 파이프라인 상태 리셋 (새로운 파이프라인 사이클 시작 시)
     */
    async resetPipelineState() {
        await this.savePipelineState({
            stage1CompletedAt: null,
            stage2CompletedAt: null,
            stage3CompletedAt: null,
            stage4CompletedAt: null,
            lastCycleDate: new Date().toDateString()
        });
        this.addLog('info', 'pipeline', '파이프라인 상태 리셋됨 - 새 사이클 시작');
    }

    /**
     * Stage 1 완료 처리 (paperCollector에서 호출)
     */
    async onStage1Complete(stats) {
        this.addLog('success', 'stage1', `논문 수집 완료 - 신규: ${stats.newPapers}, 중복: ${stats.duplicates}`);
        this.status.stage1_paperCollect.status = 'completed';
        this.status.stage1_paperCollect.lastRun = new Date().toISOString();

        // 다음 단계 예약 시간 계산
        const nextValidationTime = new Date();
        nextValidationTime.setHours(nextValidationTime.getHours() + this.config.validationDelayHours);
        this.status.stage2_validation.nextRun = nextValidationTime.toISOString();

        await this.savePipelineState({
            stage1CompletedAt: new Date().toISOString(),
            stage1Stats: stats
        });

        this.addLog('info', 'stage2', `검증 예약됨: ${nextValidationTime.toLocaleString('ko-KR')}`);
    }

    /**
     * Stage 2: 불완전한 논문 검증 및 재처리
     */
    async runStage2Validation() {
        this.addLog('info', 'stage2', '불완전한 논문 검증 시작...');
        this.status.stage2_validation.status = 'running';
        this.currentStage = 'stage2_validation';

        try {
            // 최근 24시간 내 수집된 논문 검증 및 재처리
            const result = await aiProcessor.validateAndReprocessAfterCollect();

            this.addLog('success', 'stage2',
                `검증 완료 - 완전: ${result.complete}, 불완전: ${result.incomplete}, ` +
                `재처리 성공: ${result.reprocessed}, 실패: ${result.reprocessFailed}`
            );

            this.status.stage2_validation.status = 'completed';
            this.status.stage2_validation.lastRun = new Date().toISOString();

            // 다음 단계 예약
            const nextShortsGenTime = new Date();
            nextShortsGenTime.setMinutes(nextShortsGenTime.getMinutes() + this.config.shortsGenerationDelay * 60);
            this.status.stage3_shortsGen.nextRun = nextShortsGenTime.toISOString();

            await this.savePipelineState({
                stage2CompletedAt: new Date().toISOString(),
                stage2Stats: result
            });

            this.addLog('info', 'stage3', `쇼츠 생성 예약됨: ${nextShortsGenTime.toLocaleString('ko-KR')}`);

            return result;
        } catch (error) {
            this.addLog('error', 'stage2', `검증 실패: ${error.message}`);
            this.status.stage2_validation.status = 'error';
            throw error;
        } finally {
            this.currentStage = null;
        }
    }

    /**
     * Stage 3: 쇼츠 자동 생성
     */
    async runStage3ShortsGeneration() {
        this.addLog('info', 'stage3', '쇼츠 자동 생성 시작...');
        this.status.stage3_shortsGen.status = 'running';
        this.currentStage = 'stage3_shortsGen';

        try {
            const results = {
                total: 0,
                success: 0,
                failed: 0,
                skipped: 0,
                details: []
            };

            // 쇼츠가 아직 생성되지 않은 최근 논문 조회
            const papers = await query(`
                SELECT
                    p.id,
                    p.arxiv_id,
                    p.title_ko,
                    p.title_en,
                    p.primary_category,
                    ps.tldr,
                    ps.summary_3line,
                    ps.business_insight
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.processing_status = 'completed'
                  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                  AND NOT EXISTS (SELECT 1 FROM shorts s WHERE s.paper_id = p.id)
                  AND ps.tldr IS NOT NULL
                  AND ps.tldr != ''
                ORDER BY p.created_at DESC
                LIMIT ?
            `, [this.config.maxShortsPerBatch]);

            results.total = papers.length;

            if (papers.length === 0) {
                this.addLog('info', 'stage3', '생성할 쇼츠가 없습니다 (모든 논문에 이미 쇼츠 존재)');
                results.skipped = results.total;
            } else {
                // 쇼츠 엔진 설정 로드
                let shortsSettings = {};
                try {
                    const settingsRow = await queryOne(
                        "SELECT setting_value FROM system_settings WHERE setting_key = 'shorts_engine_settings'"
                    );
                    if (settingsRow && settingsRow.setting_value) {
                        shortsSettings = JSON.parse(settingsRow.setting_value);
                    }
                } catch (e) {
                    this.addLog('warning', 'stage3', '쇼츠 설정 로드 실패, 기본값 사용');
                }

                for (const paper of papers) {
                    try {
                        // 스크립트 생성
                        const script = this.generateShortsScript(paper, shortsSettings);

                        // DB에 쇼츠 저장
                        const shortsId = await insert('shorts', {
                            paper_id: paper.id,
                            title: paper.title_ko || paper.title_en || '새 쇼츠',
                            script_hook: script.hook,
                            script_main: script.main,
                            script_cta: script.cta,
                            thumbnail_text: script.thumbnailText,
                            status: 'draft'
                        });

                        results.success++;
                        results.details.push({
                            paperId: paper.id,
                            arxivId: paper.arxiv_id,
                            shortsId,
                            status: 'created'
                        });

                        this.addLog('success', 'stage3', `쇼츠 생성됨: ${paper.arxiv_id} (ID: ${shortsId})`);

                    } catch (error) {
                        results.failed++;
                        results.details.push({
                            paperId: paper.id,
                            arxivId: paper.arxiv_id,
                            status: 'failed',
                            error: error.message
                        });
                        this.addLog('error', 'stage3', `쇼츠 생성 실패 (${paper.arxiv_id}): ${error.message}`);
                    }
                }
            }

            this.addLog('success', 'stage3',
                `쇼츠 생성 완료 - 성공: ${results.success}, 실패: ${results.failed}, 스킵: ${results.skipped}`
            );

            this.status.stage3_shortsGen.status = 'completed';
            this.status.stage3_shortsGen.lastRun = new Date().toISOString();

            // 자동 배포가 활성화된 경우 다음 단계 예약
            if (this.config.autoDeploy) {
                const nextDeployTime = new Date();
                nextDeployTime.setMinutes(nextDeployTime.getMinutes() + this.config.shortsDeployDelay * 60);
                this.status.stage4_shortsDeploy.nextRun = nextDeployTime.toISOString();
                this.addLog('info', 'stage4', `배포 예약됨: ${nextDeployTime.toLocaleString('ko-KR')}`);
            }

            await this.savePipelineState({
                stage3CompletedAt: new Date().toISOString(),
                stage3Stats: results
            });

            return results;
        } catch (error) {
            this.addLog('error', 'stage3', `쇼츠 생성 실패: ${error.message}`);
            this.status.stage3_shortsGen.status = 'error';
            throw error;
        } finally {
            this.currentStage = null;
        }
    }

    /**
     * 쇼츠 스크립트 생성 (간소화된 버전)
     */
    generateShortsScript(paper, settings = {}) {
        const title = paper.title_ko || paper.title_en || '최신 AI 연구';
        const tldr = paper.tldr || '';
        const summary3line = paper.summary_3line || '';
        const businessInsight = paper.business_insight || '';

        const introScript = settings.introScript || '안녕하세요! 오늘도 최신 AI 논문을 쉽게 풀어드립니다.';
        const outroScript = settings.outroScript || '더 자세한 내용이 궁금하시다면 프로필 링크를 확인해주세요. 구독과 좋아요 부탁드립니다!';
        const transitionWord = settings.transitionWord || '자, 그럼';

        const hook = introScript;

        let mainParts = [];
        if (tldr) {
            mainParts.push(`${transitionWord} 핵심 내용을 알아볼까요? ${tldr}`);
        }
        if (summary3line) {
            mainParts.push(`${transitionWord} 좀 더 쉽게 설명하면, ${summary3line}`);
        }
        if (businessInsight) {
            mainParts.push(`${transitionWord} 실제로 어떻게 활용될 수 있을까요? ${businessInsight}`);
        }
        if (mainParts.length === 0) {
            mainParts.push(`${transitionWord} ${title}에 대한 최신 연구입니다.`);
        }

        const main = mainParts.join(' ');
        const cta = outroScript;
        const thumbnailText = title.length <= 30 ? title : title.substring(0, 27) + '...';

        return { hook, main, cta, thumbnailText };
    }

    /**
     * Stage 4: 쇼츠 자동 배포 (플랫폼 연동 필요)
     */
    async runStage4ShortsDeploy() {
        this.addLog('info', 'stage4', '쇼츠 자동 배포 시작...');
        this.status.stage4_shortsDeploy.status = 'running';
        this.currentStage = 'stage4_shortsDeploy';

        try {
            const results = {
                total: 0,
                success: 0,
                failed: 0,
                details: []
            };

            // 배포 대기 중인 쇼츠 조회 (ready 상태 또는 draft 상태에서 오디오가 있는 것)
            const shorts = await query(`
                SELECT s.id, s.paper_id, s.title, s.status, s.audio_url
                FROM shorts s
                WHERE s.status IN ('ready', 'draft')
                  AND s.audio_url IS NOT NULL
                  AND s.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
                ORDER BY s.created_at DESC
                LIMIT 10
            `);

            results.total = shorts.length;

            if (shorts.length === 0) {
                this.addLog('info', 'stage4', '배포할 쇼츠가 없습니다');
            } else {
                // 배포 설정 로드
                let deploySettings = {};
                try {
                    const settingsRow = await queryOne(
                        "SELECT setting_value FROM system_settings WHERE setting_key = 'shorts_deploy_settings'"
                    );
                    if (settingsRow && settingsRow.setting_value) {
                        deploySettings = JSON.parse(settingsRow.setting_value);
                    }
                } catch (e) {
                    this.addLog('warning', 'stage4', '배포 설정 로드 실패');
                }

                for (const item of shorts) {
                    try {
                        // 현재는 상태만 published로 변경 (실제 플랫폼 API 연동은 별도 구현 필요)
                        await update('shorts',
                            { status: 'published' },
                            { id: item.id }
                        );

                        results.success++;
                        results.details.push({
                            shortsId: item.id,
                            title: item.title,
                            status: 'published'
                        });

                        this.addLog('success', 'stage4', `쇼츠 배포됨: ${item.title} (ID: ${item.id})`);

                    } catch (error) {
                        results.failed++;
                        results.details.push({
                            shortsId: item.id,
                            title: item.title,
                            status: 'failed',
                            error: error.message
                        });
                        this.addLog('error', 'stage4', `배포 실패 (${item.id}): ${error.message}`);
                    }
                }
            }

            this.addLog('success', 'stage4',
                `배포 완료 - 성공: ${results.success}, 실패: ${results.failed}`
            );

            this.status.stage4_shortsDeploy.status = 'completed';
            this.status.stage4_shortsDeploy.lastRun = new Date().toISOString();

            await this.savePipelineState({
                stage4CompletedAt: new Date().toISOString(),
                stage4Stats: results
            });

            // 파이프라인 사이클 완료
            this.addLog('success', 'pipeline', '🎉 파이프라인 사이클 완료!');

            return results;
        } catch (error) {
            this.addLog('error', 'stage4', `배포 실패: ${error.message}`);
            this.status.stage4_shortsDeploy.status = 'error';
            throw error;
        } finally {
            this.currentStage = null;
        }
    }

    /**
     * 수동으로 특정 단계 실행
     */
    async runStage(stageName) {
        switch (stageName) {
            case 'validation':
                return await this.runStage2Validation();
            case 'shortsGen':
                return await this.runStage3ShortsGeneration();
            case 'shortsDeploy':
                return await this.runStage4ShortsDeploy();
            case 'newsletter':
                return await this.runStage5Newsletter();
            default:
                throw new Error('알 수 없는 단계: ' + stageName);
        }
    }


    /**
     * Stage 5: 뉴스레터 발송
     * 관심 카테고리에 새 논문이 등록된 사용자에게 이메일 발송
     */
    async runStage5Newsletter() {
        this.addLog('info', 'stage5', '뉴스레터 발송 시작...');
        this.status.stage5_newsletter.status = 'running';
        this.currentStage = 'stage5_newsletter';

        try {
            const results = {
                total: 0,
                sent: 0,
                failed: 0,
                skipped: 0,
                details: []
            };

            // 뉴스레터 활성화된 사용자 조회 (관심 카테고리가 있는 사용자)
            const users = await query(`
                SELECT DISTINCT
                    u.id,
                    u.email,
                    u.nickname,
                    lc.categories
                FROM users u
                INNER JOIN (
                    SELECT user_id, GROUP_CONCAT(category) as categories
                    FROM library_categories
                    GROUP BY user_id
                ) lc ON u.id = lc.user_id
                WHERE u.newsletter_enabled = 1
                  AND u.email_verified = 1
            `);

            results.total = users.length;

            if (users.length === 0) {
                this.addLog('info', 'stage5', '뉴스레터를 받을 사용자가 없습니다');
                this.status.stage5_newsletter.status = 'completed';
                this.status.stage5_newsletter.lastRun = new Date().toISOString();
                return results;
            }

            // 최근 24시간 내 새로 수집된 논문 조회
            const newPapers = await query(`
                SELECT
                    p.id,
                    p.arxiv_id,
                    p.title_ko,
                    p.title_en,
                    p.primary_category,
                    p.authors,
                    ps.tldr
                FROM papers p
                LEFT JOIN paper_summaries ps ON p.id = ps.paper_id
                WHERE p.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                  AND p.processing_status = 'completed'
                ORDER BY p.created_at DESC
            `);

            if (newPapers.length === 0) {
                this.addLog('info', 'stage5', '발송할 새 논문이 없습니다');
                results.skipped = results.total;
                this.status.stage5_newsletter.status = 'completed';
                this.status.stage5_newsletter.lastRun = new Date().toISOString();
                return results;
            }

            this.addLog('info', 'stage5', `새 논문 ${newPapers.length}편, 대상 사용자 ${users.length}명`);

            // 이메일 서비스 로드
            const emailService = require('../services/emailService');
            const crypto = require('crypto');

            for (const user of users) {
                try {
                    const userCategories = user.categories ? user.categories.split(',') : [];
                    if (userCategories.length === 0) {
                        results.skipped++;
                        continue;
                    }

                    // 사용자의 관심 카테고리와 매칭되는 논문 필터링
                    const matchingPapers = newPapers.filter(paper => {
                        const paperCategory = paper.primary_category;
                        return userCategories.some(cat => paperCategory && paperCategory.startsWith(cat.trim()));
                    });

                    if (matchingPapers.length === 0) {
                        results.skipped++;
                        continue;
                    }

                    // 구독 해지 토큰 생성
                    const unsubscribeToken = crypto.randomBytes(32).toString('hex');

                    // 뉴스레터 발송
                    const subject = `[KoKive] 관심 분야의 새 논문 ${matchingPapers.length}편이 등록되었습니다`;
                    await emailService.sendNewsletterEmail(
                        user.email,
                        subject,
                        matchingPapers.slice(0, 10),  // 최대 10편
                        unsubscribeToken
                    );

                    results.sent++;
                    results.details.push({
                        userId: user.id,
                        email: user.email,
                        paperCount: matchingPapers.length,
                        status: 'sent'
                    });

                    this.addLog('success', 'stage5', `뉴스레터 발송: ${user.email} (${matchingPapers.length}편)`);

                } catch (error) {
                    results.failed++;
                    results.details.push({
                        userId: user.id,
                        email: user.email,
                        status: 'failed',
                        error: error.message
                    });
                    this.addLog('error', 'stage5', `발송 실패 (${user.email}): ${error.message}`);
                }
            }

            this.addLog('success', 'stage5',
                `뉴스레터 발송 완료 - 발송: ${results.sent}, 실패: ${results.failed}, 스킵: ${results.skipped}`
            );

            this.status.stage5_newsletter.status = 'completed';
            this.status.stage5_newsletter.lastRun = new Date().toISOString();

            await this.savePipelineState({
                stage5CompletedAt: new Date().toISOString(),
                stage5Stats: results
            });

            return results;
        } catch (error) {
            this.addLog('error', 'stage5', `뉴스레터 발송 실패: ${error.message}`);
            this.status.stage5_newsletter.status = 'error';
            throw error;
        } finally {
            this.currentStage = null;
        }
    }

    /**
     * 현재 상태 조회
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            currentStage: this.currentStage,
            config: this.config,
            stages: this.status,
            logs: this.logs.slice(-30)  // 최근 30개 로그
        };
    }

    /**
     * 설정 조회
     */
    getConfig() {
        return this.config;
    }

    /**
     * 로그 조회
     */
    getLogs(limit = 50) {
        return this.logs.slice(-limit);
    }
}

module.exports = new BatchPipeline();
