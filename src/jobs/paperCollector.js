/**
 * KoKive Paper Collector Job
 * arXiv 논문 자동 수집 배치 작업 (FR-001)
 *
 * 통합 파이프라인:
 * 1. arXiv에서 논문 수집
 * 2. Google Translate로 제목/초록 번역
 * 3. Claude API로 AI 요약 생성 (TL;DR, 쉬운 해설 등)
 * 4. API 사용량 로깅
 */

const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const arxivService = require('../services/arxivService');
const pwcService = require('../services/pwcService');
const translateService = require('../services/translateService');
const { query, queryOne, insert, update, transaction } = require('../config/database');
const { PAPER_CATEGORIES, PROCESSING_STATUS } = require('../config/constants');

// Claude API 클라이언트
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY
});

// API 사용량 로깅 함수
async function logApiUsage(serviceName, tokensUsed, responseTimeMs, success, errorMessage = null) {
    try {
        await insert('api_usage_logs', {
            service_name: serviceName,
            tokens_used: tokensUsed,
            response_time_ms: responseTimeMs,
            success: success,
            error_message: errorMessage
        });
    } catch (error) {
        console.error('API 사용량 로깅 실패:', error.message);
    }
}

class PaperCollector {
    constructor() {
        this.isRunning = false;
        this.lastRun = null;
        this.schedulerInterval = null;
        this.lastScheduleCheck = null;
        this.scheduledTime = null;  // 현재 설정된 스케줄 시간 (HH:MM)
        this.scheduleEnabled = false;
        this.stats = {
            totalCollected: 0,
            newPapers: 0,
            duplicates: 0,
            errors: 0
        };
        this.progress = {
            currentCategory: '',
            currentCategoryIndex: 0,
            totalCategories: 0,
            papersInCategory: 0,
            currentPaperIndex: 0,
            currentPaperTitle: '',
            percentage: 0,
            status: 'idle',
            message: '',
            lastError: ''
        };
        this.logs = [];  // 최근 로그 저장
    }

    // 로그 추가 함수
    addLog(type, message) {
        const logEntry = {
            time: new Date().toISOString(),
            type: type,  // 'info', 'success', 'error', 'warning'
            message: message
        };
        this.logs.push(logEntry);
        // 최근 50개만 유지
        if (this.logs.length > 50) {
            this.logs.shift();
        }
        // 콘솔에도 출력
        const prefix = type === 'error' ? '❌' : type === 'warning' ? '⚠️' : type === 'success' ? '✅' : '📋';
        console.log(prefix + ' ' + message);
    }

    updateProgress(updates) {
        this.progress = Object.assign(this.progress, updates);
        // 퍼센트 계산
        if (this.progress.totalCategories > 0) {
            const catProgress = (this.progress.currentCategoryIndex / this.progress.totalCategories);
            const paperProgress = this.progress.papersInCategory > 0
                ? (this.progress.currentPaperIndex / this.progress.papersInCategory) / this.progress.totalCategories
                : 0;
            this.progress.percentage = Math.min(100, Math.round((catProgress + paperProgress) * 100));
        }
    }

    resetProgress() {
        this.progress = {
            currentCategory: '',
            currentCategoryIndex: 0,
            totalCategories: 0,
            papersInCategory: 0,
            currentPaperIndex: 0,
            currentPaperTitle: '',
            percentage: 0,
            status: 'idle',
            message: '',
            lastError: ''
        };
        this.logs = [];
    }

    start() {
        // 기존 cron 대신 매분 체크하는 인터벌 사용 (DB 기반 동적 스케줄)
        console.log('✅ 논문 수집 스케줄러 시작 (DB 기반 동적 스케줄)');

        // 초기 스케줄 로드
        this.loadScheduleFromDB();

        // 매분 스케줄 체크 (60초마다)
        this.schedulerInterval = setInterval(() => {
            this.checkAndRunSchedule();
        }, 60 * 1000);

        // 시작 시 한번 체크
        this.checkAndRunSchedule();
    }

    stop() {
        if (this.schedulerInterval) {
            clearInterval(this.schedulerInterval);
            this.schedulerInterval = null;
            console.log('⏹️ 논문 수집 스케줄러 중지됨');
        }
    }

    async loadScheduleFromDB() {
        try {
            const setting = await queryOne(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'paper_collect_schedule'"
            );
            if (setting && setting.setting_value) {
                const config = JSON.parse(setting.setting_value);
                this.scheduleEnabled = config.enabled || false;
                this.scheduledTime = config.time || '02:00';  // 기본값 새벽 2시
                // 마지막 실행 날짜도 DB에서 복원 (서버 재시작 대응)
                if (config.lastRunDate) {
                    this.lastScheduleCheck = config.lastRunDate;
                }
                console.log('📅 스케줄 로드됨: ' + this.scheduledTime + ' (활성화: ' + this.scheduleEnabled + ', 마지막실행: ' + (this.lastScheduleCheck || '없음') + ')');
            } else {
                // 기본값 설정
                this.scheduleEnabled = false;
                this.scheduledTime = '02:00';
                console.log('📅 스케줄 설정 없음, 기본값 사용: 02:00 (비활성화)');
            }
        } catch (error) {
            console.error('스케줄 로드 실패:', error.message);
            this.scheduleEnabled = false;
            this.scheduledTime = '02:00';
        }
    }

    async updateSchedule(time, enabled) {
        try {
            const config = JSON.stringify({ time: time, enabled: enabled });
            const existing = await queryOne(
                "SELECT id FROM system_settings WHERE setting_key = 'paper_collect_schedule'"
            );

            if (existing) {
                await update('system_settings',
                    { setting_value: config },
                    { setting_key: 'paper_collect_schedule' }
                );
            } else {
                await insert('system_settings', {
                    setting_key: 'paper_collect_schedule',
                    setting_value: config,
                    description: '논문 자동 수집 스케줄 설정'
                });
            }

            this.scheduledTime = time;
            this.scheduleEnabled = enabled;
            console.log('📅 스케줄 업데이트됨: ' + time + ' (활성화: ' + enabled + ')');
            return { success: true };
        } catch (error) {
            console.error('스케줄 저장 실패:', error.message);
            return { success: false, error: error.message };
        }
    }

    getSchedule() {
        return {
            time: this.scheduledTime,
            enabled: this.scheduleEnabled,
            nextRun: this.getNextRunTime()
        };
    }

    getNextRunTime() {
        if (!this.scheduleEnabled || !this.scheduledTime) return null;

        const now = new Date();
        const [hours, minutes] = this.scheduledTime.split(':').map(Number);

        const nextRun = new Date(now);
        nextRun.setHours(hours, minutes, 0, 0);

        // 이미 지난 시간이면 내일로
        if (nextRun <= now) {
            nextRun.setDate(nextRun.getDate() + 1);
        }

        return nextRun.toISOString();
    }

    async checkAndRunSchedule() {
        // 스케줄 다시 로드 (동적 변경 감지)
        await this.loadScheduleFromDB();

        if (!this.scheduleEnabled || !this.scheduledTime) return;

        const now = new Date();
        const currentHour = now.getHours();
        const currentMinute = now.getMinutes();
        const currentDate = now.toDateString();

        // 스케줄 시간 파싱
        const [scheduleHour, scheduleMinute] = this.scheduledTime.split(':').map(Number);

        // 현재 시간이 스케줄 시간과 같거나 지났는지 확인 (같은 시간대 내에서)
        // 예: 스케줄이 02:00이고 현재 02:05라면 실행 (하지만 03:00이면 실행 안함)
        const isScheduleTime = (currentHour === scheduleHour && currentMinute >= scheduleMinute && currentMinute < scheduleMinute + 30);

        // 오늘 이미 실행했는지 확인
        const alreadyRanToday = this.lastScheduleCheck === currentDate;

        // 로그 (디버깅용)
        if (currentHour === scheduleHour) {
            console.log(`📋 스케줄 체크: 현재 ${currentHour}:${currentMinute}, 예약 ${scheduleHour}:${scheduleMinute}, 오늘실행: ${alreadyRanToday}`);
        }

        // 설정된 시간에 도달했고, 오늘 아직 실행 안 했으면 실행
        if (isScheduleTime && !alreadyRanToday) {
            this.lastScheduleCheck = currentDate;
            // DB에도 마지막 실행 날짜 저장 (서버 재시작 대응)
            await this.saveLastRunDate(currentDate);
            console.log('⏰ 예약된 시간 도달: ' + this.scheduledTime + ' - 논문 수집 시작');
            this.addLog('info', '예약된 자동 수집 시작 (' + this.scheduledTime + ')');
            await this.run();
        }
    }

    async saveLastRunDate(dateString) {
        try {
            const setting = await queryOne(
                "SELECT setting_value FROM system_settings WHERE setting_key = 'paper_collect_schedule'"
            );
            if (setting && setting.setting_value) {
                const config = JSON.parse(setting.setting_value);
                config.lastRunDate = dateString;
                await update('system_settings',
                    { setting_value: JSON.stringify(config) },
                    { setting_key: 'paper_collect_schedule' }
                );
            }
        } catch (error) {
            console.error('마지막 실행 날짜 저장 실패:', error.message);
        }
    }

    async run() {
        if (this.isRunning) {
            this.addLog('warning', '논문 수집 작업이 이미 실행 중입니다.');
            return;
        }

        this.isRunning = true;
        this.lastRun = new Date();
        this.resetStats();
        this.resetProgress();

        try {
            // PAPER_CATEGORIES에서 키(cs.AI, cs.LG 등)를 가져옴
            const categoryKeys = process.env.COLLECT_CATEGORIES
                ? process.env.COLLECT_CATEGORIES.split(',')
                : Object.keys(PAPER_CATEGORIES);

            const papersPerCategory = parseInt(process.env.PAPERS_PER_CATEGORY) || 20;

            this.addLog('info', '수집 대상 카테고리: ' + categoryKeys.join(', '));
            this.addLog('info', '카테고리당 논문 수: ' + papersPerCategory);

            this.updateProgress({
                totalCategories: categoryKeys.length,
                status: 'running',
                message: '수집 시작...'
            });

            for (let i = 0; i < categoryKeys.length; i++) {
                const categoryKey = categoryKeys[i];  // 'cs.AI', 'cs.LG' 등
                const categoryInfo = PAPER_CATEGORIES[categoryKey];
                const categoryName = categoryInfo ? categoryInfo.nameKo : categoryKey;

                this.updateProgress({
                    currentCategoryIndex: i,
                    currentCategory: categoryName,
                    message: categoryName + ' (' + categoryKey + ') 카테고리 수집 중...'
                });

                try {
                    await this.collectByCategory(categoryKey, categoryName, papersPerCategory);
                    await this.delay(2000);
                } catch (error) {
                    this.addLog('error', categoryKey + ' (' + categoryName + ') 수집 실패: ' + error.message);
                    this.updateProgress({ lastError: error.message });
                    this.stats.errors++;
                }
            }

            this.updateProgress({
                percentage: 100,
                status: 'completed',
                message: '수집 완료! 신규 ' + this.stats.newPapers + '개, 중복 ' + this.stats.duplicates + '개, 오류 ' + this.stats.errors + '개'
            });

            this.addLog('success', '수집 완료 - 신규: ' + this.stats.newPapers + ', 중복: ' + this.stats.duplicates + ', 오류: ' + this.stats.errors);
            await this.recordJobCompletion();

            // 배치 파이프라인에 Stage 1 완료 알림
            try {
                const batchPipeline = require('./batchPipeline');
                await batchPipeline.onStage1Complete(this.stats);
            } catch (pipelineError) {
                console.error('파이프라인 알림 실패:', pipelineError.message);
            }

        } catch (error) {
            this.addLog('error', '논문 수집 작업 오류: ' + error.message);
            this.updateProgress({
                status: 'error',
                message: '오류: ' + error.message,
                lastError: error.message
            });
            await this.recordJobError(error.message);
        } finally {
            this.isRunning = false;
        }
    }

    async collectByCategory(categoryKey, categoryName, maxPapers) {
        this.addLog('info', categoryKey + ' (' + categoryName + ') 카테고리 arXiv API 호출 중...');

        let papers = [];
        try {
            papers = await arxivService.fetchPapersByCategory(categoryKey, maxPapers);
            this.addLog('info', categoryKey + ': arXiv에서 ' + papers.length + '개 논문 가져옴');
        } catch (error) {
            this.addLog('error', categoryKey + ' arXiv API 호출 실패: ' + error.message);
            throw error;
        }

        if (papers.length === 0) {
            this.addLog('warning', categoryKey + ': 수집된 논문이 없음');
            return;
        }

        this.updateProgress({
            papersInCategory: papers.length,
            currentPaperIndex: 0
        });

        for (let i = 0; i < papers.length; i++) {
            const paper = papers[i];
            const shortTitle = paper.titleEn ? paper.titleEn.substring(0, 50) + '...' : 'Unknown';

            this.updateProgress({
                currentPaperIndex: i + 1,
                currentPaperTitle: shortTitle,
                message: categoryName + ': ' + (i + 1) + '/' + papers.length + ' - ' + shortTitle
            });

            try {
                const result = await this.savePaper(paper);
                this.stats.totalCollected++;

                if (result.isNew) {
                    this.addLog('success', '[신규] ' + paper.arxivId + ': ' + shortTitle);
                } else {
                    this.addLog('info', '[중복] ' + paper.arxivId);
                }
            } catch (error) {
                if (error.code === 'ER_DUP_ENTRY') {
                    this.stats.duplicates++;
                    this.addLog('info', '[중복] ' + paper.arxivId);
                } else {
                    this.addLog('error', '[저장실패] ' + paper.arxivId + ': ' + error.message);
                    this.updateProgress({ lastError: error.message });
                    this.stats.errors++;
                }
            }
        }

        this.addLog('success', categoryKey + ' (' + categoryName + '): ' + papers.length + '개 처리 완료');
    }

    async savePaper(paper) {
        const existing = await queryOne('SELECT id FROM papers WHERE arxiv_id = ?', [paper.arxivId]);
        if (existing) {
            this.stats.duplicates++;
            return { id: existing.id, isNew: false };
        }

        // 제목과 초록 번역
        let titleKo = null;
        let abstractKo = null;
        try {
            this.addLog('info', '번역 중: ' + paper.arxivId);
            const translations = await translateService.translatePaper({
                titleEn: paper.titleEn,
                abstractEn: paper.abstractEn
            });
            titleKo = translations.titleKo;
            abstractKo = translations.abstractKo;
            this.addLog('success', '번역 완료: ' + (titleKo ? titleKo.substring(0, 30) + '...' : 'N/A'));
        } catch (error) {
            this.addLog('warning', '번역 실패 (원본 사용): ' + error.message);
            // 번역 실패해도 저장은 계속 진행
        }

        let githubInfo = null;
        try {
            const pwcResult = await pwcService.getRepositoriesByArxivId(paper.arxivId);
            if (pwcResult.found && pwcResult.repositories.length > 0) {
                githubInfo = {
                    repositories: pwcResult.repositories.slice(0, 5),
                    pwcUrl: pwcResult.paperUrl
                };
            }
        } catch (error) {
            // PWC 실패는 무시 - 논문 저장에 영향 없음
        }

        const paperId = await insert('papers', {
            arxiv_id: paper.arxivId,
            title_en: paper.titleEn,
            title_ko: titleKo,
            abstract_en: paper.abstractEn,
            abstract_ko: abstractKo,
            authors: JSON.stringify(paper.authors),
            primary_category: paper.primaryCategory,
            categories: JSON.stringify(paper.categories),
            published_at: paper.publishedAt,
            pdf_url: paper.pdfUrl,
            arxiv_url: paper.arxivUrl,
            github_urls: githubInfo ? JSON.stringify(githubInfo.repositories.map(function(r) { return r.url; })) : null,
            pwc_url: githubInfo && githubInfo.pwcUrl ? githubInfo.pwcUrl : null,
            processing_status: PROCESSING_STATUS.PENDING
        });

        this.stats.newPapers++;

        // AI 요약 생성 (통합 파이프라인)
        if (abstractKo && titleKo) {
            try {
                this.addLog('info', 'AI 요약 생성 중: ' + paper.arxivId);
                await this.generateAISummary(paperId, paper, titleKo, abstractKo);
                this.addLog('success', 'AI 요약 완료: ' + paper.arxivId);
            } catch (error) {
                this.addLog('warning', 'AI 요약 실패 (나중에 재처리): ' + error.message);
                // 요약 실패해도 논문 저장은 완료됨
            }
        } else {
            this.addLog('warning', '번역 없음 - AI 요약 스킵: ' + paper.arxivId);
        }

        // 처리 상태 업데이트
        try {
            await update('papers', { processing_status: PROCESSING_STATUS.COMPLETED }, { id: paperId });
        } catch (err) {
            // 상태 업데이트 실패는 무시
        }

        return { id: paperId, isNew: true };
    }

    // AI 요약 생성 함수 (Claude API)
    async generateAISummary(paperId, paper, titleKo, abstractKo) {
        const startTime = Date.now();

        try {
            const response = await anthropic.messages.create({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 3500,
                messages: [
                    {
                        role: 'user',
                        content: `다음 AI/ML 연구 논문을 분석하여 다양한 요약을 생성해주세요.

영문 제목: ${paper.titleEn}
한글 제목: ${titleKo || '없음'}

영문 초록:
${paper.abstractEn}

한글 초록:
${abstractKo || '없음'}

다음 JSON 형식으로 응답해주세요:
{
    "tldr": "한 문장 핵심 요약 (최대 100자)",
    "one_line_summary": "논문 리스트에 표시할 한줄 요약 (최대 150자) - '~를 연구했다', '~를 제안했다' 형식",
    "summary_3line": "세 줄 요약 - 핵심 포인트를 각 줄로 나눠서",
    "summary_detailed": "중학생도 이해할 수 있는 쉬운 해설",
    "business_insight": "비즈니스/산업 시사점 (2-3문장)"
}

summary_detailed는 다음 구조로 작성해주세요 (500-800자):

🎓 **쉬운 해설**

1️⃣ **이게 뭔 연구야?**
[연구 주제를 쉽게 설명, 비유 사용]

2️⃣ **문제가 뭐야?**
[해결하려는 문제를 일상적인 예시로 설명]

3️⃣ **어떻게 해결했어?**
[핵심 방법을 간단히 설명, 기술 용어 최소화]

4️⃣ **결과는?**
[주요 성과를 숫자나 비교로 표현]

5️⃣ **왜 중요해?**
[이 연구가 가져올 변화나 의미]

📌 **한 줄 요약**: [핵심 내용을 한 문장으로]

중요 지침:
1. summary_detailed는 반드시 중학생 수준으로 쉽게 작성
2. 모든 내용은 한국어로 작성
3. JSON만 출력하세요.`
                    }
                ]
            });

            // API 사용량 로깅
            const responseTimeMs = Date.now() - startTime;
            const tokensUsed = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
            await logApiUsage('claude_haiku', tokensUsed, responseTimeMs, true);

            const content = response.content[0].text;
            let parsed;

            // JSON 파싱
            let cleanContent = content
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            // 각 필드를 추출
            const tldrMatch = cleanContent.match(/"tldr"\s*:\s*"([^"]*)"/);
            const oneLineMatch = cleanContent.match(/"one_line_summary"\s*:\s*"([^"]*)"/);
            const threeLineMatch = cleanContent.match(/"summary_3line"\s*:\s*"([^"]*)"/);
            const businessMatch = cleanContent.match(/"business_insight"\s*:\s*"([^"]*)"/);

            // summary_detailed 추출 (멀티라인)
            const detailedMatch = cleanContent.match(/"summary_detailed"\s*:\s*"([\s\S]*?)(?:",\s*"business_insight|"\s*\})/);
            let detailed = detailedMatch ? detailedMatch[1] : '';
            detailed = detailed.replace(/\\"/g, '"').replace(/\\n/g, '\n');

            parsed = {
                tldr: tldrMatch ? tldrMatch[1] : '',
                one_line_summary: oneLineMatch ? oneLineMatch[1] : '',
                summary_3line: threeLineMatch ? threeLineMatch[1] : '',
                summary_detailed: detailed,
                business_insight: businessMatch ? businessMatch[1] : ''
            };

            // DB에 요약 저장
            await insert('paper_summaries', {
                paper_id: paperId,
                tldr: parsed.tldr,
                one_line_summary: parsed.one_line_summary,
                summary_3line: parsed.summary_3line,
                summary_detailed: parsed.summary_detailed,
                business_insight: parsed.business_insight
            });

            // papers 테이블에도 one_line_summary 업데이트
            if (parsed.one_line_summary) {
                await update('papers', { one_line_summary: parsed.one_line_summary }, { id: paperId });
            }

            return parsed;
        } catch (error) {
            // 실패 시에도 API 사용량 로깅
            const responseTimeMs = Date.now() - startTime;
            await logApiUsage('claude_haiku', 0, responseTimeMs, false, error.message);
            throw error;
        }
    }

    async collectSingle(arxivId) {
        try {
            const paper = await arxivService.fetchPaperById(arxivId);
            const paperId = await this.savePaper(paper);
            return { success: true, paperId: paperId };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async collectByKeyword(keyword, options) {
        options = options || {};
        const maxResults = options.maxResults || 20;
        const categories = options.categories || [];
        try {
            const papers = await arxivService.searchPapers(keyword, { maxResults: maxResults, categories: categories });
            let collected = 0;
            let duplicates = 0;

            for (const paper of papers) {
                try {
                    await this.savePaper(paper);
                    collected++;
                } catch (error) {
                    if (error.code === 'ER_DUP_ENTRY') duplicates++;
                }
            }
            return { success: true, found: papers.length, collected: collected, duplicates: duplicates };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    resetStats() {
        this.stats = { totalCollected: 0, newPapers: 0, duplicates: 0, errors: 0 };
    }

    logStats() {
        console.log('\n📊 수집 결과:');
        console.log('   총 처리: ' + this.stats.totalCollected);
        console.log('   신규 저장: ' + this.stats.newPapers);
        console.log('   중복 스킵: ' + this.stats.duplicates);
        console.log('   오류: ' + this.stats.errors);
    }

    async recordJobCompletion() {
        try {
            await insert('job_queue', {
                job_type: 'paper_collect',
                payload: JSON.stringify({ runAt: this.lastRun, stats: this.stats }),
                status: 'completed',
                completed_at: new Date()
            });
        } catch (error) {
            console.error('작업 완료 기록 실패:', error.message);
        }
    }

    async recordJobError(errorMessage) {
        try {
            await insert('job_queue', {
                job_type: 'paper_collect',
                payload: JSON.stringify({ runAt: this.lastRun, stats: this.stats }),
                status: 'failed',
                error_message: errorMessage
            });
        } catch (error) {
            console.error('작업 오류 기록 실패:', error.message);
        }
    }

    delay(ms) {
        return new Promise(function(resolve) { setTimeout(resolve, ms); });
    }

    getStatus() {
        return {
            isRunning: this.isRunning,
            lastRun: this.lastRun,
            stats: this.stats,
            progress: this.progress,
            logs: this.logs.slice(-20),  // 최근 20개 로그만 반환
            schedule: this.getSchedule()
        };
    }

    // 로그만 가져오기
    getLogs() {
        return this.logs;
    }
}

module.exports = new PaperCollector();
