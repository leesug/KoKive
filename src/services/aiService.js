/**
 * KoKive AI Service
 * Claude API (번역/요약) + OpenAI API (임베딩) + Gemini API 하이브리드 구조
 * 무료회원: Haiku, 유료회원: Sonnet
 *
 * admin 설정에 따라 동적으로 AI provider 선택:
 * - paper_collection: Gemini 또는 Claude 선택 가능
 */

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { insert, update, queryOne, query } = require('../config/database');
const aiSettingsService = require('./aiSettingsService');
const geminiService = require('./geminiService');

// 번역 품질 등급
const TRANSLATION_TIER = {
    FREE: 'haiku',      // 무료 회원
    PREMIUM: 'sonnet'   // 유료 회원
};

// Claude 모델 매핑 (API 키 접근 가능한 모델만 사용)
const CLAUDE_MODELS = {
    haiku: 'claude-3-haiku-20240307',       // Claude 3 Haiku (stable, API 접근 가능)
    sonnet: 'claude-sonnet-4-20250514'      // Claude Sonnet 4 (API 접근 가능)
};

class AIService {
    constructor() {
        this.anthropic = null;
        this.openai = null;
        this.initialized = false;
    }

    /**
     * AI 클라이언트 초기화
     */
    initialize() {
        // Claude 초기화 (번역/요약용)
        if (process.env.ANTHROPIC_API_KEY) {
            this.anthropic = new Anthropic({
                apiKey: process.env.ANTHROPIC_API_KEY
            });
            console.log('✅ Claude API 초기화 완료');
        } else {
            console.warn('⚠️  ANTHROPIC_API_KEY가 설정되지 않았습니다. 번역/요약 기능이 비활성화됩니다.');
        }

        // OpenAI 초기화 (임베딩용)
        if (process.env.OPENAI_API_KEY) {
            this.openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY
            });
            console.log('✅ OpenAI API 초기화 완료 (임베딩 전용)');
        } else {
            console.warn('⚠️  OPENAI_API_KEY가 설정되지 않았습니다. 시맨틱 검색 기능이 비활성화됩니다.');
        }

        this.initialized = this.anthropic !== null || this.openai !== null;
    }

    /**
     * AI 서비스 사용 가능 여부
     */
    isAvailable() {
        return this.initialized;
    }

    /**
     * 번역 서비스 사용 가능 여부
     */
    isTranslationAvailable() {
        return this.anthropic !== null;
    }

    /**
     * 임베딩 서비스 사용 가능 여부
     */
    isEmbeddingAvailable() {
        return this.openai !== null;
    }

    /**
     * 사용자 등급에 따른 모델 선택
     * @param {string} tier - 'haiku' 또는 'sonnet'
     */
    getModel(tier = TRANSLATION_TIER.FREE) {
        return CLAUDE_MODELS[tier] || CLAUDE_MODELS.haiku;
    }

    /**
     * 논문 전체 처리 (번역 + 요약) - admin 설정에 따라 provider 선택
     * @param {Object} paper - 논문 데이터
     * @returns {Promise<Object>} - 처리 결과
     */
    async processPaper(paper) {
        // admin 설정에서 paper_collection의 provider/model 확인
        try {
            const aiConfig = await aiSettingsService.getAiConfig('paper_collection');
            const provider = aiConfig.provider || 'claude';
            const model = aiConfig.model;

            console.log(`[AI Service] paper_collection provider: ${provider}, model: ${model}`);

            // Gemini 사용 설정인 경우
            if (provider === 'gemini') {
                return this.processPaperWithGemini(paper, model);
            }
        } catch (configError) {
            console.warn('[AI Service] Failed to load AI settings, falling back to Claude:', configError.message);
        }

        // 기본값: Claude 사용
        return this.processPaperWithTier(paper, TRANSLATION_TIER.FREE);
    }

    /**
     * Gemini를 사용한 논문 처리
     * @param {Object} paper - 논문 데이터
     * @param {string} model - Gemini 모델명
     * @returns {Promise<Object>} - 처리 결과
     */
    async processPaperWithGemini(paper, model) {
        const startTime = Date.now();

        try {
            // 제목 번역 (Gemini 사용)
            const titleKo = await this.translateTitleWithGemini(paper.title_en, model);

            // 초록 번역 (Gemini 사용)
            const abstractKo = await this.translateAbstractWithGemini(paper.abstract_en, model);

            // 요약 생성 (기존 geminiService 활용)
            const summaryResult = await geminiService.generatePaperSummary({
                titleEn: paper.title_en,
                titleKo: titleKo,
                abstractEn: paper.abstract_en,
                abstractKo: abstractKo
            }, paper.id);

            const processingTime = Date.now() - startTime;

            console.log(`[Gemini] 논문 처리 완료: ${paper.id}, ${processingTime}ms`);

            return {
                titleKo: titleKo,
                abstractKo: abstractKo,
                summary: {
                    tldr: summaryResult.tldr || '',
                    one_line_summary: summaryResult.one_line_summary || '',
                    summary_3line: summaryResult.summary_3line || '',
                    summary_detailed: summaryResult.summary_detailed || '',
                    business_insight: summaryResult.business_insight || '',
                    shorts_script: null
                },
                terms: summaryResult.terms || [],
                tokensUsed: summaryResult.tokensUsed || 0,
                processingTime: processingTime,
                translationTier: 'gemini',
                model: model
            };
        } catch (error) {
            console.error(`[Gemini] 논문 처리 실패:`, error.message);
            throw error;
        }
    }

    /**
     * Gemini로 제목 번역
     */
    async translateTitleWithGemini(titleEn, model) {
        const https = require('https');
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
        }

        const prompt = `다음 AI/ML 학술 논문 제목을 한국어로 번역해주세요. 기술 용어는 적절히 번역하거나 음역해주세요. 번역된 제목만 출력하세요.

제목: ${titleEn}`;

        const result = await this.callGeminiAPI(prompt, model, apiKey);
        return result.text.trim();
    }

    /**
     * Gemini로 초록 번역
     */
    async translateAbstractWithGemini(abstractEn, model) {
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
        }

        const prompt = `다음 AI/ML 학술 논문 초록을 한국어로 번역해주세요. 기술적 정확성과 학술적 문체를 유지하며, 원문의 논리적 흐름을 보존해주세요. 번역된 초록만 출력하세요.

초록:
${abstractEn}`;

        const result = await this.callGeminiAPI(prompt, model, apiKey);
        return result.text.trim();
    }

    /**
     * Gemini API 호출 (동적 모델)
     */
    async callGeminiAPI(prompt, model, apiKey) {
        const https = require('https');

        return new Promise((resolve, reject) => {
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const url = new URL(apiUrl);

            const requestBody = JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 4096,
                    topP: 0.95,
                    topK: 40
                }
            });

            const options = {
                hostname: url.hostname,
                path: url.pathname + url.search,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(requestBody)
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', chunk => { data += chunk; });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);

                        if (parsed.error) {
                            reject(new Error(parsed.error.message || 'Gemini API 오류'));
                            return;
                        }

                        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
                        const usageMetadata = parsed.usageMetadata || {};
                        const tokensUsed = (usageMetadata.promptTokenCount || 0) +
                            (usageMetadata.candidatesTokenCount || 0);

                        resolve({ text, tokensUsed });
                    } catch (e) {
                        reject(new Error('응답 파싱 실패: ' + e.message));
                    }
                });
            });

            req.on('error', reject);
            req.setTimeout(60000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.write(requestBody);
            req.end();
        });
    }

    /**
     * 논문 처리 (등급별) - 단일 API 호출로 모든 처리 통합
     * @param {Object} paper - 논문 데이터
     * @param {string} tier - 번역 등급 ('haiku' 또는 'sonnet')
     */
    async processPaperWithTier(paper, tier = TRANSLATION_TIER.FREE) {
        if (!this.isTranslationAvailable()) {
            throw new Error('번역 서비스가 초기화되지 않았습니다.');
        }

        const model = this.getModel(tier);
        const startTime = Date.now();

        try {
            // 단일 API 호출로 모든 처리 통합
            const result = await this.processAllInOne(paper.title_en, paper.abstract_en, model);

            // API 사용량 로깅 (향상된 버전)
            await this.logApiUsage(`claude_${tier}_process`, result.tokens, Date.now() - startTime, true, null, {
                paperId: paper.id,
                operationType: 'paper_processing',
                model: model
            });

            return {
                titleKo: result.titleKo,
                abstractKo: result.abstractKo,
                summary: result.summary,
                terms: result.terms,
                tokensUsed: result.tokens,
                processingTime: Date.now() - startTime,
                translationTier: tier,
                model: model
            };
        } catch (error) {
            await this.logApiUsage(`claude_${tier}_process`, 0, Date.now() - startTime, false, error.message, {
                paperId: paper.id,
                operationType: 'paper_processing',
                model: model
            });
            throw error;
        }
    }

    /**
     * 단일 API 호출로 번역 + 요약 + 용어 추출 모두 처리
     * 기존 4번 API 호출 → 1번으로 통합 (비용 절감)
     */
    async processAllInOne(titleEn, abstractEn, model) {
        const response = await this.anthropic.messages.create({
            model: model,
            max_tokens: 5000,
            messages: [
                {
                    role: 'user',
                    content: `다음 AI/ML 연구 논문을 분석하여 번역과 요약을 생성해주세요.

영문 제목: ${titleEn}

영문 초록:
${abstractEn}

다음 JSON 형식으로 응답해주세요:
{
    "title_ko": "한국어 제목",
    "abstract_ko": "한국어 초록 (학술적 문체, 존대말)",
    "tldr": "한 문장 요약 (최대 100자, 존대말)",
    "one_line_summary": "논문 리스트용 한줄 요약 (최대 150자) - '~를 연구했습니다' 형식 (존대말)",
    "summary_3line": "핵심1\n핵심2\n핵심3 (반드시 \\n으로 줄바꿈 구분, 존대말)",
    "summary_detailed": "HTML 형식의 쉬운 해설 (아래 형식 엄수, 존대말)",
    "business_insight": "비즈니스 시사점 (2-3문장, 존대말)",
    "shorts_script": {"hook": "오프닝 (존대말)", "main": "메인 (존대말)", "cta": "CTA (존대말)"},
    "terms": [{"term_en": "영어", "term_ko": "한국어", "definition": "정의 (존대말)"}]
}

★★★ summary_detailed 필수 형식 (HTML, 압축된 짧은 형태, 반드시 존대말) ★★★
<div class="easy-explain">
<p class="easy-title">📚 "비유를 포함한 한줄 제목"</p>
<p><strong>1️⃣ 이 연구는 무엇인가요?</strong><br>일상 비유로 2-3문장 설명 (존대말)</p>
<p><strong>2️⃣ 어떤 문제를 해결하나요?</strong><br>해결하려는 문제 2-3문장 (존대말)</p>
<p><strong>3️⃣ 어떻게 해결했나요?</strong><br>핵심 방법 2-3문장 (존대말)</p>
<p><strong>4️⃣ 결과는 어떤가요?</strong><br>성과를 숫자/비교로 1-2문장 (존대말)</p>
<p><strong>5️⃣ 왜 중요한가요?</strong><br>의미 1-2문장 (존대말)</p>
<p class="easy-summary">📌 <strong>한줄요약:</strong> 핵심 한 문장 (존대말)</p>
</div>

중요 지침:
1. summary_detailed는 반드시 위 HTML 형식으로, 총 300자 이내로 압축
2. 중학생 수준 (전문용어 최소화, 비유 필수)
3. terms는 핵심 용어 5개
4. 모든 내용 한국어
5. ★★★ 반드시 존대말(~입니다, ~합니다, ~됩니다)로 작성하세요. 반말(~야, ~해, ~임) 절대 금지 ★★★
6. JSON만 출력`
                }
            ]
        });

        const content = response.content[0].text;
        const tokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);

        try {
            // JSON 추출 (코드블록 제거)
            let cleanContent = content
                .replace(/```json\s*/gi, '')
                .replace(/```\s*/g, '')
                .trim();

            const jsonMatch = cleanContent.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : cleanContent);

            return {
                titleKo: parsed.title_ko || '',
                abstractKo: parsed.abstract_ko || '',
                summary: {
                    tldr: parsed.tldr || '',
                    one_line_summary: parsed.one_line_summary || '',
                    summary_3line: parsed.summary_3line || '',
                    summary_detailed: parsed.summary_detailed || '',
                    business_insight: parsed.business_insight || '',
                    shorts_script: parsed.shorts_script || null
                },
                terms: parsed.terms || [],
                tokens: tokens
            };
        } catch (parseError) {
            console.error('JSON 파싱 실패:', parseError.message);
            console.error('원본 응답:', content.substring(0, 500));

            // 파싱 실패 시 기본값 반환
            return {
                titleKo: '',
                abstractKo: '',
                summary: {
                    tldr: '요약을 생성할 수 없습니다.',
                    one_line_summary: '요약을 생성할 수 없습니다.',
                    summary_3line: '',
                    summary_detailed: '',
                    business_insight: '',
                    shorts_script: null
                },
                terms: [],
                tokens: tokens
            };
        }
    }

    /**
     * Sonnet으로 재번역 (유료회원 조회 시)
     * @param {number} paperId - 논문 ID
     * @returns {Promise<Object>} - 업그레이드된 번역 결과
     */
    async upgradeTranslation(paperId) {
        // 논문 원본 데이터 조회
        const paper = await queryOne(
            'SELECT id, title_en, abstract_en FROM papers WHERE id = ?',
            [paperId]
        );

        if (!paper) {
            throw new Error('논문을 찾을 수 없습니다.');
        }

        // Sonnet으로 재번역
        const result = await this.processPaperWithTier(paper, TRANSLATION_TIER.PREMIUM);

        // 기존 요약 데이터 업데이트 (Haiku → Sonnet)
        const existingSummary = await queryOne(
            'SELECT id FROM paper_summaries WHERE paper_id = ?',
            [paperId]
        );

        if (existingSummary) {
            await update('paper_summaries', {
                tldr: result.summary.tldr,
                one_line_summary: result.summary.one_line_summary,
                summary_3line: result.summary.summary_3line,
                summary_detailed: result.summary.summary_detailed,
                business_insight: result.summary.business_insight,
                shorts_hook: result.summary.shorts_script?.hook,
                shorts_main: result.summary.shorts_script?.main,
                shorts_cta: result.summary.shorts_script?.cta,
                translation_tier: TRANSLATION_TIER.PREMIUM,
                upgraded_at: new Date()
            }, 'paper_id = ?', [paperId]);
        }

        // 논문 테이블도 업데이트
        await update('papers', {
            title_ko: result.titleKo,
            abstract_ko: result.abstractKo,
            translation_tier: TRANSLATION_TIER.PREMIUM
        }, 'id = ?', [paperId]);

        console.log(`✅ 논문 ${paperId} Sonnet 번역 업그레이드 완료`);

        return result;
    }

    /**
     * 번역 등급 확인
     * @param {number} paperId - 논문 ID
     * @returns {Promise<string>} - 현재 번역 등급
     */
    async getTranslationTier(paperId) {
        const paper = await queryOne(
            'SELECT translation_tier FROM papers WHERE id = ?',
            [paperId]
        );
        return paper?.translation_tier || TRANSLATION_TIER.FREE;
    }

    /**
     * 제목 번역 (Claude)
     */
    async translateTitle(titleEn, model) {
        const response = await this.anthropic.messages.create({
            model: model,
            max_tokens: 300,
            messages: [
                {
                    role: 'user',
                    content: `다음 AI/ML 학술 논문 제목을 한국어로 번역해주세요. 기술 용어는 적절히 번역하거나 음역해주세요. 번역된 제목만 출력하세요.

제목: ${titleEn}`
                }
            ]
        });

        return {
            text: response.content[0].text.trim(),
            tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0
        };
    }

    /**
     * 초록 번역 (Claude)
     */
    async translateAbstract(abstractEn, model) {
        const response = await this.anthropic.messages.create({
            model: model,
            max_tokens: 3000,
            messages: [
                {
                    role: 'user',
                    content: `다음 AI/ML 학술 논문 초록을 한국어로 번역해주세요. 기술적 정확성과 학술적 문체를 유지하며, 원문의 논리적 흐름을 보존해주세요.

초록:
${abstractEn}`
                }
            ]
        });

        return {
            text: response.content[0].text.trim(),
            tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0
        };
    }

    /**
     * 다층 요약 생성 (Claude) - 통합 API
     * 하나의 API 호출로 쉬운 해설, 한줄 요약, AI 번역, 요약 모두 생성
     */
    async generateMultiLayerSummary(titleEn, abstractEn, titleKo, abstractKo, model) {
        const response = await this.anthropic.messages.create({
            model: model,
            max_tokens: 4000,
            messages: [
                {
                    role: 'user',
                    content: `다음 AI/ML 연구 논문을 분석하여 다양한 수준의 요약을 생성해주세요.

영문 제목: ${titleEn}
한글 제목: ${titleKo}

영문 초록:
${abstractEn}

한글 초록:
${abstractKo}

다음 JSON 형식으로 응답해주세요:
{
    "tldr": "한 문장 요약 (최대 100자, 존대말) - 핵심 기여를 포착",
    "one_line_summary": "논문 리스트에 표시할 한줄 요약 (최대 150자) - '~를 연구했습니다', '~를 제안했습니다' 형식 (존대말)",
    "summary_3line": "핵심1\n핵심2\n핵심3 (반드시 \\n으로 줄바꿈 구분, 번호 없이, 존대말)",
    "summary_detailed": "중학생도 이해할 수 있는 쉬운 해설 (500-800자, 존대말). 다음 구조로 작성:

🎓 **쉬운 해설**

1️⃣ **이 연구는 무엇인가요?**
[연구 주제를 쉽게 설명, 비유 사용 - 존대말]

2️⃣ **어떤 문제를 해결하나요?**
[해결하려는 문제를 일상적인 예시로 설명 - 존대말]

3️⃣ **어떻게 해결했나요?**
[핵심 방법을 간단히 설명, 기술 용어 최소화 - 존대말]

4️⃣ **결과는 어떤가요?**
[주요 성과를 숫자나 비교로 표현 - 존대말]

5️⃣ **왜 중요한가요?**
[이 연구가 가져올 변화나 의미 - 존대말]

📌 **한 줄 요약**: [핵심 내용을 한 문장으로 - 존대말]",
    "business_insight": "비즈니스/산업 시사점 및 잠재적 응용 (2-3문장, 존대말)",
    "shorts_script": {
        "hook": "숏폼 영상용 주목을 끄는 오프닝 (1-2문장, 존대말)",
        "main": "연구를 설명하는 메인 콘텐츠 (3-4문장, 존대말)",
        "cta": "참여를 유도하는 CTA (1문장, 존대말)"
    }
}

중요 지침:
1. summary_detailed는 반드시 중학생 수준으로 쉽게 작성 (전문 용어 최소화, 비유 사용)
2. one_line_summary는 논문 리스트에 제목과 함께 표시되므로 핵심만 간결하게
3. 모든 내용은 한국어로 작성
4. ★★★ 반드시 존대말(~입니다, ~합니다, ~됩니다)로 작성하세요. 반말(~야, ~해, ~임) 절대 금지 ★★★
5. JSON만 출력하세요.`
                }
            ]
        });

        const content = response.content[0].text;
        let parsed;

        try {
            // JSON 추출 (코드블록 제거)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        } catch {
            parsed = {
                tldr: '요약을 생성할 수 없습니다.',
                one_line_summary: '요약을 생성할 수 없습니다.',
                summary_3line: '요약을 생성할 수 없습니다.',
                summary_detailed: '요약을 생성할 수 없습니다.',
                business_insight: null,
                shorts_script: null
            };
        }

        return {
            data: parsed,
            tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0
        };
    }

    /**
     * 용어 추출 (Claude)
     */
    async extractTerms(abstractEn, model) {
        const response = await this.anthropic.messages.create({
            model: model,
            max_tokens: 2000,
            messages: [
                {
                    role: 'user',
                    content: `다음 초록에서 핵심 AI/ML 기술 용어를 추출해주세요.

초록:
${abstractEn}

JSON 형식으로 응답해주세요:
{
    "terms": [
        {
            "term_en": "영어 용어",
            "term_ko": "한국어 용어",
            "definition": "한국어로 간단한 정의 (1-2문장)"
        }
    ]
}

가장 중요한 기술 용어 5-10개를 추출하세요. JSON만 출력하세요.`
                }
            ]
        });

        let terms = [];
        try {
            const content = response.content[0].text;
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
            terms = parsed.terms || [];
        } catch {
            terms = [];
        }

        return {
            terms,
            tokens: response.usage?.input_tokens + response.usage?.output_tokens || 0
        };
    }

    /**
     * 쇼츠 스크립트 생성 (별도 호출용) - Claude
     * @param {string} titleKo - 논문 한국어 제목
     * @param {string} tldr - TLDR 요약
     * @param {string} businessInsight - 비즈니스 인사이트
     * @param {string} style - 스크립트 스타일
     * @param {number|null} paperId - 논문 ID (API 로깅용)
     * @param {number|null} shortsId - 쇼츠 ID (API 로깅용)
     */
    async generateShortsScript(titleKo, tldr, businessInsight, style = 'engaging', paperId = null, shortsId = null) {
        if (!this.isTranslationAvailable()) {
            throw new Error('번역 서비스가 초기화되지 않았습니다.');
        }

        const startTime = Date.now();
        const stylePrompts = {
            engaging: '흥미롭고 호기심을 자극하는',
            professional: '전문적이고 신뢰감 있는',
            casual: '친근하고 이해하기 쉬운',
            dramatic: '극적이고 임팩트 있는'
        };

        try {
            const response = await this.anthropic.messages.create({
                model: CLAUDE_MODELS.haiku, // 쇼츠는 Haiku로 충분
                max_tokens: 1000,
                messages: [
                    {
                        role: 'user',
                        content: `다음 AI 연구 논문에 대한 숏폼 영상 스크립트를 한국어로 작성해주세요.

제목: ${titleKo}
TL;DR: ${tldr}
비즈니스 인사이트: ${businessInsight || 'N/A'}

스타일: ${stylePrompts[style] || stylePrompts.engaging}

JSON 형식으로 스크립트를 작성해주세요:
{
    "hook": "주목을 끄는 오프닝 (1-2문장, 최대 50자)",
    "main": "메인 설명 (3-4문장, 이해하기 쉽게)",
    "cta": "CTA (1문장)",
    "thumbnail_text": "썸네일용 텍스트 (최대 15자)"
}

소셜 미디어 청중에게 매력적이면서 정확성을 유지해야 합니다. JSON만 출력하세요.`
                    }
                ]
            });

            const inputTokens = response.usage?.input_tokens || 0;
            const outputTokens = response.usage?.output_tokens || 0;
            const processingTime = Date.now() - startTime;

            // 상세 API 사용량 로깅
            await this.logApiUsage('claude_haiku_shorts', inputTokens + outputTokens, processingTime, true, null, {
                paperId: paperId,
                shortsId: shortsId,
                operationType: 'shorts_script',
                inputTokens: inputTokens,
                outputTokens: outputTokens,
                model: CLAUDE_MODELS.haiku
            });

            try {
                const content = response.content[0].text;
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                return JSON.parse(jsonMatch ? jsonMatch[0] : content);
            } catch {
                return {
                    hook: '이 AI 연구가 업계를 바꿀 수 있습니다!',
                    main: tldr,
                    cta: '더 자세한 내용은 프로필 링크에서!',
                    thumbnail_text: 'AI 연구 핵심'
                };
            }
        } catch (error) {
            const processingTime = Date.now() - startTime;
            await this.logApiUsage('claude_haiku_shorts', 0, processingTime, false, error.message, {
                paperId: paperId,
                shortsId: shortsId,
                operationType: 'shorts_script',
                model: CLAUDE_MODELS.haiku
            });
            throw error;
        }
    }

    /**
     * TTS 사용량 로깅 (외부에서 호출용)
     * @param {string} provider - TTS 제공자 (google, melotts 등)
     * @param {number} characterCount - 텍스트 문자 수
     * @param {number} responseTimeMs - 응답 시간
     * @param {boolean} success - 성공 여부
     * @param {string|null} errorMessage - 에러 메시지
     * @param {Object} options - 추가 옵션
     */
    async logTTSUsage(provider, characterCount, responseTimeMs, success, errorMessage = null, options = {}) {
        const { paperId, shortsId, voice, audioLengthSeconds } = options;

        // TTS 비용 계산 (Google Cloud TTS 기준)
        let costUsd = 0;
        if (provider === 'google') {
            // Google Cloud TTS: WaveNet $16/1M chars, Standard $4/1M chars
            const isWaveNet = options.voice?.includes('Wavenet');
            costUsd = isWaveNet
                ? characterCount * 16 / 1000000
                : characterCount * 4 / 1000000;
        } else if (provider === 'melotts') {
            // MeloTTS는 로컬/무료이므로 비용 없음
            costUsd = 0;
        }

        await this.logApiUsage(`tts_${provider}`, characterCount, responseTimeMs, success, errorMessage, {
            paperId: paperId,
            shortsId: shortsId,
            operationType: 'tts_synthesis',
            model: options.voice || provider,
            inputTokens: characterCount, // 문자 수를 tokens 필드에 저장
            outputTokens: audioLengthSeconds || 0 // 오디오 길이(초)를 output_tokens에 저장
        });

        return costUsd;
    }

    /**
     * 텍스트 임베딩 생성 (OpenAI)
     */
    async generateEmbedding(text) {
        if (!this.isEmbeddingAvailable()) {
            throw new Error('임베딩 서비스가 초기화되지 않았습니다.');
        }

        const response = await this.openai.embeddings.create({
            model: process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small',
            input: text.substring(0, 8000),
            dimensions: 1536
        });

        await this.logApiUsage('openai_embedding', response.usage?.total_tokens || 0, 0, true);

        return response.data[0].embedding;
    }

    /**
     * 질문에 대한 AI 답변 생성 (Q&A 보조) - Claude
     */
    async generateAnswer(question, paperContext) {
        if (!this.isTranslationAvailable()) {
            throw new Error('AI 서비스가 초기화되지 않았습니다.');
        }

        const response = await this.anthropic.messages.create({
            model: CLAUDE_MODELS.haiku,
            max_tokens: 1500,
            messages: [
                {
                    role: 'user',
                    content: `다음 연구 논문 맥락을 바탕으로 질문에 도움이 되는 답변을 제공해주세요.

논문 맥락:
제목: ${paperContext.title}
초록: ${paperContext.abstract}

질문: ${question}

간결하고 정확한 답변을 한국어로 제공해주세요. 주어진 맥락에서 답변할 수 없는 질문이면 정중하게 알려주세요.`
                }
            ]
        });

        await this.logApiUsage('claude_haiku', response.usage?.input_tokens + response.usage?.output_tokens || 0, 0, true);

        return response.content[0].text.trim();
    }

    /**
     * PDF 본문 번역 (On-demand)
     * @param {string} text - PDF에서 추출된 원문
     * @param {string} tier - 번역 등급 ('haiku' 또는 'sonnet')
     * @returns {Promise<Object>} 번역 결과 및 메타데이터
     */
    async translateFullText(text, tier = TRANSLATION_TIER.FREE) {
        if (!this.isTranslationAvailable()) {
            throw new Error('번역 서비스가 초기화되지 않았습니다.');
        }

        const model = this.getModel(tier);
        const startTime = Date.now();

        // 텍스트를 청크로 분할 (4000자 단위)
        const chunks = this.splitIntoChunks(text, 4000);
        const translatedChunks = [];
        let totalInputTokens = 0;
        let totalOutputTokens = 0;

        console.log(`📝 본문 번역 시작: ${chunks.length}개 청크, 모델: ${model}`);

        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            console.log(`  - 청크 ${i + 1}/${chunks.length} 번역 중...`);

            try {
                const response = await this.anthropic.messages.create({
                    model: model,
                    max_tokens: 8000,
                    messages: [
                        {
                            role: 'user',
                            content: `다음 AI/ML 학술 논문 본문을 한국어로 번역해주세요.

규칙:
1. 학술적 문체를 유지하세요
2. 수학 공식과 코드는 원본 그대로 유지하세요
3. 기술 용어는 한글로 번역하고 필요시 영문을 괄호 안에 병기하세요
4. 문단 구조를 유지하세요
5. 번역된 텍스트만 출력하세요

본문:
${chunk}`
                        }
                    ]
                });

                const translated = response.content[0].text.trim();
                translatedChunks.push(translated);

                totalInputTokens += response.usage?.input_tokens || 0;
                totalOutputTokens += response.usage?.output_tokens || 0;

                // Rate limiting: 청크 간 짧은 대기
                if (i < chunks.length - 1) {
                    await this.delay(500);
                }
            } catch (error) {
                console.error(`  - 청크 ${i + 1} 번역 실패:`, error.message);
                translatedChunks.push(`[번역 실패: ${chunk.substring(0, 100)}...]`);
            }
        }

        const processingTime = Date.now() - startTime;
        const totalTokens = totalInputTokens + totalOutputTokens;

        // 비용 계산
        const cost = this.calculateCost(totalInputTokens, totalOutputTokens, tier);

        // API 사용량 로깅 (향상된 버전)
        await this.logApiUsage(`claude_fulltext_${tier}`, totalTokens, processingTime, true, null, {
            operationType: 'fulltext_translation',
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            model: model
        });

        console.log(`✅ 본문 번역 완료: ${totalTokens} 토큰, ${(processingTime / 1000).toFixed(1)}초, $${cost.toFixed(4)}`);

        return {
            translatedText: translatedChunks.join('\n\n'),
            originalText: text,
            sectionCount: chunks.length,
            wordCount: text.split(/\s+/).length,
            tokenCount: totalTokens,
            inputTokens: totalInputTokens,
            outputTokens: totalOutputTokens,
            costUsd: cost,
            processingTime,
            tier,
            model
        };
    }

    /**
     * 텍스트를 청크로 분할
     */
    splitIntoChunks(text, maxChunkSize = 4000) {
        const chunks = [];
        const paragraphs = text.split(/\n\n+/);
        let currentChunk = '';

        for (const para of paragraphs) {
            if (currentChunk.length + para.length + 2 > maxChunkSize && currentChunk) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            currentChunk += para + '\n\n';
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        // 청크가 없으면 문장 단위로 분할
        if (chunks.length === 0 && text.length > 0) {
            const sentences = text.split(/(?<=[.!?])\s+/);
            currentChunk = '';
            for (const sentence of sentences) {
                if (currentChunk.length + sentence.length > maxChunkSize && currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }
                currentChunk += sentence + ' ';
            }
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
            }
        }

        return chunks.length > 0 ? chunks : [text];
    }

    /**
     * 번역 비용 계산
     */
    calculateCost(inputTokens, outputTokens, tier = 'haiku') {
        const pricing = {
            haiku: {
                input: 0.25 / 1000000,   // $0.25 per 1M input tokens
                output: 1.25 / 1000000   // $1.25 per 1M output tokens
            },
            sonnet: {
                input: 3.00 / 1000000,   // $3.00 per 1M input tokens
                output: 15.00 / 1000000  // $15.00 per 1M output tokens
            }
        };

        const modelPricing = pricing[tier] || pricing.haiku;
        return (inputTokens * modelPricing.input) + (outputTokens * modelPricing.output);
    }

    /**
     * 딜레이 헬퍼
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * API 사용량 로깅 (향상된 버전)
     * @param {string} serviceName - 서비스명 (claude_haiku, claude_sonnet, openai_embedding, tts_google 등)
     * @param {number} tokensUsed - 총 사용 토큰 (TTS의 경우 문자 수)
     * @param {number} responseTimeMs - 응답 시간
     * @param {boolean} success - 성공 여부
     * @param {string|null} errorMessage - 에러 메시지
     * @param {Object} options - 추가 옵션 (paperId, shortsId, operationType, inputTokens, outputTokens, model)
     */
    async logApiUsage(serviceName, tokensUsed, responseTimeMs, success, errorMessage = null, options = {}) {
        try {
            const { paperId, shortsId, operationType, inputTokens, outputTokens, model } = options;

            // 비용 계산
            let costUsd = 0;

            // TTS 비용 계산
            if (serviceName.startsWith('tts_')) {
                if (serviceName === 'tts_google') {
                    // Google Cloud TTS: WaveNet $16/1M chars, Standard $4/1M chars
                    const isWaveNet = model?.includes('Wavenet');
                    costUsd = isWaveNet
                        ? tokensUsed * 16 / 1000000
                        : tokensUsed * 4 / 1000000;
                }
                // MeloTTS는 무료
            } else {
                // Claude 비용 계산
                const tier = serviceName.includes('sonnet') ? 'sonnet' : 'haiku';

                if (inputTokens && outputTokens) {
                    costUsd = this.calculateCost(inputTokens, outputTokens, tier);
                } else if (tokensUsed > 0) {
                    // 대략적인 비용 계산 (input:output = 2:1 가정)
                    const estimatedInput = Math.floor(tokensUsed * 0.67);
                    const estimatedOutput = tokensUsed - estimatedInput;
                    costUsd = this.calculateCost(estimatedInput, estimatedOutput, tier);
                }

                // OpenAI 임베딩 비용 계산
                if (serviceName === 'openai_embedding') {
                    costUsd = tokensUsed * 0.02 / 1000000; // $0.02 per 1M tokens
                }
            }

            // api_usage_logs 테이블에 insert (metadata 컬럼 제외 - 없을 수 있음)
            await insert('api_usage_logs', {
                service_name: serviceName,
                paper_id: paperId || null,
                operation_type: operationType || this.inferOperationType(serviceName),
                model_used: model || this.inferModel(serviceName),
                tokens_used: tokensUsed,
                input_tokens: inputTokens || 0,
                output_tokens: outputTokens || 0,
                cost_usd: costUsd,
                response_time_ms: responseTimeMs,
                success,
                error_message: errorMessage
            });
        } catch (error) {
            console.error('API 사용량 로깅 실패:', error.message);
        }
    }

    /**
     * 서비스명에서 작업 유형 추론
     */
    inferOperationType(serviceName) {
        if (serviceName.includes('fulltext')) return 'fulltext_translation';
        if (serviceName.includes('embedding')) return 'embedding';
        if (serviceName.includes('summary') || serviceName.includes('process')) return 'paper_processing';
        if (serviceName.includes('translate')) return 'translation';
        if (serviceName.includes('answer') || serviceName.includes('qa')) return 'qa';
        if (serviceName.includes('shorts')) return 'shorts_script';
        if (serviceName.startsWith('tts_')) return 'tts_synthesis';
        return 'general';
    }

    /**
     * 서비스명에서 모델 추론
     */
    inferModel(serviceName) {
        if (serviceName.includes('sonnet')) return CLAUDE_MODELS.sonnet;
        if (serviceName.includes('haiku')) return CLAUDE_MODELS.haiku;
        if (serviceName.includes('embedding')) return 'text-embedding-3-small';
        if (serviceName === 'tts_google') return 'google-cloud-tts';
        if (serviceName === 'tts_melotts') return 'melotts';
        return CLAUDE_MODELS.haiku;
    }
}

// 번역 등급 상수 내보내기
module.exports.TRANSLATION_TIER = TRANSLATION_TIER;

// 싱글톤 인스턴스
const aiService = new AIService();

// 환경 변수가 로드된 후 초기화
if (process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY) {
    aiService.initialize();
}

module.exports = aiService;
