/**
 * KoKive Jobs Index
 * 배치 작업 초기화 및 관리
 */

const paperCollector = require('./paperCollector');
const aiProcessor = require('./aiProcessor');
const batchPipeline = require('./batchPipeline');

/**
 * 모든 스케줄러 시작
 */
function startAllJobs() {
    console.log('\n╔══════════════════════════════════════════════╗');
    console.log('║           🔄 배치 작업 스케줄러 시작          ║');
    console.log('╚══════════════════════════════════════════════╝\n');

    // 논문 수집 스케줄러
    if (process.env.ENABLE_PAPER_COLLECTOR !== 'false') {
        paperCollector.start();
    } else {
        console.log('⏸️  논문 수집 스케줄러 비활성화');
    }

    // AI 처리 스케줄러
    if (process.env.ENABLE_AI_PROCESSOR !== 'false') {
        aiProcessor.start();
    } else {
        console.log('⏸️  AI 처리 스케줄러 비활성화');
    }

    // 배치 파이프라인 스케줄러
    if (process.env.ENABLE_BATCH_PIPELINE !== 'false') {
        batchPipeline.start();
    } else {
        console.log('⏸️  배치 파이프라인 스케줄러 비활성화');
    }

    console.log('');
}

/**
 * 수동 실행 함수들
 */
const manualTriggers = {
    /**
     * 논문 수집 수동 실행
     */
    async collectPapers() {
        return await paperCollector.run();
    },

    /**
     * 단일 논문 수집
     */
    async collectSinglePaper(arxivId) {
        return await paperCollector.collectSingle(arxivId);
    },

    /**
     * 키워드로 논문 수집
     */
    async collectByKeyword(keyword, options) {
        return await paperCollector.collectByKeyword(keyword, options);
    },

    /**
     * AI 처리 수동 실행
     */
    async processAI() {
        return await aiProcessor.run();
    },

    /**
     * 단일 논문 AI 처리
     */
    async processSinglePaper(paperId) {
        return await aiProcessor.processPaper(paperId);
    },

    /**
     * 실패한 논문 재처리
     */
    async retryFailedPapers(limit) {
        return await aiProcessor.retryFailed(limit);
    }
};

/**
 * 상태 조회
 */
function getJobsStatus() {
    return {
        paperCollector: paperCollector.getStatus(),
        aiProcessor: aiProcessor.getStatus(),
        batchPipeline: batchPipeline.getStatus()
    };
}

/**
 * AI 처리 대기열 상태
 */
async function getQueueStatus() {
    return await aiProcessor.getQueueStatus();
}

/**
 * 파이프라인 관련 함수들
 */
const pipelineTriggers = {
    /**
     * 파이프라인 설정 조회
     */
    getPipelineConfig() {
        return batchPipeline.getConfig();
    },

    /**
     * 파이프라인 설정 저장
     */
    async updatePipelineConfig(config) {
        return await batchPipeline.saveConfig(config);
    },

    /**
     * 파이프라인 상태 조회
     */
    getPipelineStatus() {
        return batchPipeline.getStatus();
    },

    /**
     * 파이프라인 특정 단계 수동 실행
     */
    async runPipelineStage(stageName) {
        return await batchPipeline.runStage(stageName);
    },

    /**
     * 파이프라인 상태 리셋
     */
    async resetPipeline() {
        return await batchPipeline.resetPipelineState();
    },

    /**
     * 파이프라인 로그 조회
     */
    getPipelineLogs(limit) {
        return batchPipeline.getLogs(limit);
    }
};

module.exports = {
    startAllJobs,
    manualTriggers,
    pipelineTriggers,
    getJobsStatus,
    getQueueStatus,
    paperCollector,
    aiProcessor,
    batchPipeline
};
