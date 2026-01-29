/**
 * KoKive AI Q&A Service
 * 논문 내용을 분석하여 전문가 수준의 AI 답변 생성
 *
 * 기능:
 * - 논문 내용 추출 (ar5iv HTML, arXiv HTML, PDF)
 * - Gemini API를 활용한 전문가 답변 생성
 * - 포인트 비용 계산 (기본비용 + API비용 + 마진)
 */

const https = require('https');
const { query, queryOne, insert } = require('../config/database');
const textExtractor = require('./textExtractor');

// Gemini API URL
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

// AI 답변 끝에 추가되는 면책 문구
const AI_DISCLAIMER = '\n\n---\n⚠️ **AI도 실수를 할 수 있습니다.** 이 답변은 AI가 논문 내용을 분석하여 생성한 것으로, 정확성을 보장하지 않습니다. 중요한 결정을 내리기 전에 원본 논문을 직접 확인하시기 바랍니다.';

/**
 * 시스템 설정에서 AI Q&A 설정 조회
 */
async function getAiQnaSettings() {
    const settings = {};

    const rows = await query(
        "SELECT setting_key, setting_value FROM system_settings WHERE setting_key LIKE 'ai_qna_%'"
    );

    for (const row of rows || []) {
        const key = row.setting_key.replace('ai_qna_', '');
        settings[key] = row.setting_value;
    }

    return {
        enabled: settings.enabled === 'true',
        model: settings.model || 'gemini-2.0-flash',
        baseCost: parseInt(settings.base_cost) || 50,
        marginPercent: parseInt(settings.margin_percent) || 20,
        inputCostPer1m: parseFloat(settings.input_cost_per_1m) || 0.075,
        outputCostPer1m: parseFloat(settings.output_cost_per_1m) || 0.30
    };
}

/**
 * API 사용량 로깅
 */
async function logApiUsage(serviceName, tokensUsed, responseTimeMs, success, errorMessage = null, paperId = null, questionId = null) {
    try {
        await insert('api_usage_logs', {
            service_name: serviceName,
            tokens_used: tokensUsed,
            response_time_ms: responseTimeMs,
            success: success,
            error_message: errorMessage,
            paper_id: paperId,
            question_id: questionId
        });
    } catch (error) {
        console.error('API 사용량 로깅 실패:', error.message);
    }
}

/**
 * 포인트 비용 계산
 */
function calculatePointCost(inputTokens, outputTokens, settings) {
    // API 비용 계산 (USD)
    const inputCostUsd = (inputTokens / 1_000_000) * settings.inputCostPer1m;
    const outputCostUsd = (outputTokens / 1_000_000) * settings.outputCostPer1m;
    const apiCostUsd = inputCostUsd + outputCostUsd;

    // 원화 변환 (1 USD = 1400 KRW 기준)
    const exchangeRate = 1400;
    const apiCostKrw = apiCostUsd * exchangeRate;

    // 포인트 변환 (10원 = 1포인트)
    const apiCostPoints = Math.ceil(apiCostKrw / 10);

    // 총 비용 = 기본비용 + API비용
    const subtotal = settings.baseCost + apiCostPoints;

    // 마진 추가
    const marginCharge = Math.ceil(subtotal * settings.marginPercent / 100);
    const totalPoints = subtotal + marginCharge;

    return {
        inputTokens,
        outputTokens,
        apiCostUsd,
        apiCostKrw,
        apiCostPoints,
        baseCost: settings.baseCost,
        marginPercent: settings.marginPercent,
        marginCharge,
        totalPoints
    };
}

/**
 * 포인트 비용 예상 (질문 전 미리 계산)
 */
async function estimateCost(paperId) {
    const settings = await getAiQnaSettings();

    if (!settings.enabled) {
        throw new Error('AI Q&A 기능이 비활성화되어 있습니다.');
    }

    // 논문 정보 조회
    const paper = await queryOne(
        'SELECT arxiv_id, title_ko, abstract_en FROM papers WHERE id = ?',
        [paperId]
    );

    if (!paper) {
        throw new Error('논문을 찾을 수 없습니다.');
    }

    // 예상 토큰 계산 (초록 기준)
    const abstractLength = paper.abstract_en?.length || 1000;
    const estimatedInputTokens = Math.ceil(abstractLength / 4) + 2000; // 프롬프트 포함
    const estimatedOutputTokens = 1500; // 평균 답변 길이

    const costEstimate = calculatePointCost(estimatedInputTokens, estimatedOutputTokens, settings);

    return {
        paperId,
        paperTitle: paper.title_ko,
        estimatedCost: costEstimate.totalPoints,
        breakdown: {
            baseCost: costEstimate.baseCost,
            estimatedApiCost: costEstimate.apiCostPoints,
            marginPercent: costEstimate.marginPercent,
            marginCharge: costEstimate.marginCharge
        },
        note: '실제 비용은 논문 내용과 답변 길이에 따라 달라질 수 있습니다.'
    };
}

/**
 * Gemini API 호출
 */
async function callGeminiAPI(prompt, apiKey) {
    return new Promise((resolve, reject) => {
        const url = new URL(GEMINI_API_URL);
        url.searchParams.append('key', apiKey);

        const requestBody = JSON.stringify({
            contents: [
                {
                    parts: [
                        { text: prompt }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8192,
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
                    const inputTokens = usageMetadata.promptTokenCount || 0;
                    const outputTokens = usageMetadata.candidatesTokenCount || 0;

                    resolve({ text, inputTokens, outputTokens });
                } catch (e) {
                    reject(new Error('응답 파싱 실패: ' + e.message));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(120000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(requestBody);
        req.end();
    });
}

/**
 * 논문 내용 요약 추출 (AI 답변용)
 */
async function extractPaperContext(arxivId) {
    try {
        // textExtractor를 사용하여 논문 내용 추출
        const extraction = await textExtractor.extract(arxivId);

        // 섹션들을 텍스트로 변환
        let contextText = '';
        let charCount = 0;
        const maxChars = 30000; // 최대 30,000자 (약 7,500 토큰)

        for (const section of extraction.sections) {
            if (charCount >= maxChars) break;

            // 섹션 제목
            if (section.title_en) {
                contextText += `\n## ${section.title_en}\n`;
            }

            // 단락들
            for (const para of section.paragraphs) {
                if (charCount >= maxChars) break;

                const remainingChars = maxChars - charCount;
                const text = para.text_en.substring(0, remainingChars);
                contextText += text + '\n\n';
                charCount += text.length;
            }
        }

        return {
            text: contextText.trim(),
            sourceType: extraction.sourceType,
            sourceUrl: extraction.sourceUrl,
            totalSections: extraction.totalSections,
            totalChars: charCount
        };
    } catch (error) {
        console.error(`[aiQnaService] 논문 내용 추출 실패: ${error.message}`);
        throw error;
    }
}

/**
 * AI 답변 생성
 */
async function generateAnswer(questionId, userId) {
    const startTime = Date.now();
    const settings = await getAiQnaSettings();

    if (!settings.enabled) {
        throw new Error('AI Q&A 기능이 비활성화되어 있습니다.');
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY가 설정되지 않았습니다.');
    }

    // 질문 정보 조회
    const question = await queryOne(
        `SELECT q.id, q.title, q.content, q.paper_id,
                p.arxiv_id, p.title_ko as paperTitleKo, p.title_en as paperTitleEn,
                p.abstract_ko, p.abstract_en
         FROM questions q
         JOIN papers p ON q.paper_id = p.id
         WHERE q.id = ?`,
        [questionId]
    );

    if (!question) {
        throw new Error('질문을 찾을 수 없습니다.');
    }

    // 이미 AI 답변이 있는지 확인
    const existingAiAnswer = await queryOne(
        'SELECT id FROM answers WHERE question_id = ? AND is_ai_generated = 1',
        [questionId]
    );

    if (existingAiAnswer) {
        throw new Error('이미 AI 답변이 존재합니다.');
    }

    // 논문 내용 추출
    console.log(`[aiQnaService] 논문 내용 추출 중: ${question.arxiv_id}`);
    let paperContext;
    try {
        paperContext = await extractPaperContext(question.arxiv_id);
    } catch (error) {
        // 추출 실패 시 초록만 사용
        console.warn(`[aiQnaService] 논문 전체 내용 추출 실패, 초록 사용: ${error.message}`);
        paperContext = {
            text: question.abstract_en || question.abstract_ko || '',
            sourceType: 'abstract_only',
            totalChars: (question.abstract_en || question.abstract_ko || '').length
        };
    }

    // AI 프롬프트 생성
    const prompt = `당신은 AI/ML 연구 분야의 전문가입니다. 다음 논문의 내용을 바탕으로 사용자의 질문에 전문가 수준으로 답변해주세요.

## 논문 정보
- 제목 (영문): ${question.paperTitleEn}
- 제목 (한글): ${question.paperTitleKo || '없음'}
- arXiv ID: ${question.arxiv_id}

## 논문 내용
${paperContext.text}

## 사용자 질문
제목: ${question.title}
내용: ${question.content}

## 답변 지침
1. 논문의 내용을 정확하게 파악하고, 질문에 대해 전문가 수준으로 상세하게 답변하세요.
2. 답변은 반드시 한국어로 작성하세요.
3. 논문에서 직접적으로 언급되지 않은 내용은 "논문에서 직접 언급되지 않았지만..." 등의 표현을 사용하세요.
4. 전문 용어는 한글 번역과 영문을 병기하세요 (예: 트랜스포머(Transformer)).
5. 답변 구조:
   - 질문의 핵심에 대한 직접적인 답변
   - 관련 논문 내용 설명
   - 추가적인 맥락이나 배경 지식 (필요시)
6. 마크다운 형식을 사용하여 가독성 있게 작성하세요.
7. 답변 끝에 면책 문구를 추가하지 마세요 (시스템에서 자동 추가됩니다).

답변:`;

    try {
        // Gemini API 호출
        console.log(`[aiQnaService] AI 답변 생성 중...`);
        const result = await callGeminiAPI(prompt, apiKey);

        // 비용 계산
        const cost = calculatePointCost(result.inputTokens, result.outputTokens, settings);
        const responseTimeMs = Date.now() - startTime;

        // 답변에 면책 문구 추가
        const finalAnswer = result.text.trim() + AI_DISCLAIMER;

        // API 사용량 로깅
        await logApiUsage(
            'gemini_qna',
            result.inputTokens + result.outputTokens,
            responseTimeMs,
            true,
            null,
            question.paper_id,
            questionId
        );

        console.log(`[aiQnaService] AI 답변 생성 완료: ${result.outputTokens} 토큰, ${cost.totalPoints}P, ${responseTimeMs}ms`);

        return {
            answer: finalAnswer,
            questionId,
            paperId: question.paper_id,
            tokenUsage: {
                input: result.inputTokens,
                output: result.outputTokens,
                total: result.inputTokens + result.outputTokens
            },
            cost,
            processingTime: responseTimeMs,
            sourceType: paperContext.sourceType
        };
    } catch (error) {
        const responseTimeMs = Date.now() - startTime;

        // 실패 로깅
        await logApiUsage(
            'gemini_qna',
            0,
            responseTimeMs,
            false,
            error.message,
            question.paper_id,
            questionId
        );

        throw error;
    }
}

/**
 * AI 답변 생성 및 저장 (포인트 차감 포함)
 */
async function createAiAnswer(questionId, userId) {
    // 1. AI 답변 생성
    const result = await generateAnswer(questionId, userId);

    // 2. 사용자 포인트 확인
    const userPoints = await queryOne(
        'SELECT balance FROM point_balances WHERE user_id = ?',
        [userId]
    );

    const currentBalance = userPoints?.balance || 0;

    if (currentBalance < result.cost.totalPoints) {
        throw new Error(`포인트가 부족합니다. 필요: ${result.cost.totalPoints}P, 보유: ${currentBalance}P`);
    }

    // 3. 답변 저장
    const answerResult = await insert('answers', {
        question_id: questionId,
        user_id: null, // AI 답변은 user_id가 null
        content: result.answer,
        is_ai_generated: 1
    });

    // 4. 포인트 차감
    await insert('point_transactions', {
        user_id: userId,
        amount: -result.cost.totalPoints,
        balance_after: currentBalance - result.cost.totalPoints,
        type: 'use',
        description: `AI Q&A 답변 생성 (질문 #${questionId})`,
        reference_type: 'ai_qna',
        reference_id: answerResult.insertId
    });

    // 포인트 잔액 업데이트
    await query(
        'UPDATE point_balances SET balance = balance - ?, updated_at = NOW() WHERE user_id = ?',
        [result.cost.totalPoints, userId]
    );

    return {
        answerId: answerResult.insertId,
        ...result,
        pointsDeducted: result.cost.totalPoints,
        remainingBalance: currentBalance - result.cost.totalPoints
    };
}

/**
 * AI Q&A 설정 업데이트 (관리자용)
 */
async function updateSettings(settings) {
    const settingsMap = {
        enabled: settings.enabled !== undefined ? String(settings.enabled) : undefined,
        model: settings.model,
        base_cost: settings.baseCost !== undefined ? String(settings.baseCost) : undefined,
        margin_percent: settings.marginPercent !== undefined ? String(settings.marginPercent) : undefined,
        input_cost_per_1m: settings.inputCostPer1m !== undefined ? String(settings.inputCostPer1m) : undefined,
        output_cost_per_1m: settings.outputCostPer1m !== undefined ? String(settings.outputCostPer1m) : undefined
    };

    for (const [key, value] of Object.entries(settingsMap)) {
        if (value !== undefined) {
            await query(
                `INSERT INTO system_settings (setting_key, setting_value, updated_at)
                 VALUES (?, ?, NOW())
                 ON DUPLICATE KEY UPDATE setting_value = ?, updated_at = NOW()`,
                [`ai_qna_${key}`, value, value]
            );
        }
    }

    return getAiQnaSettings();
}

module.exports = {
    getAiQnaSettings,
    estimateCost,
    generateAnswer,
    createAiAnswer,
    updateSettings,
    calculatePointCost
};
