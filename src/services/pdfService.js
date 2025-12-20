/**
 * KoKive PDF Service
 * Python 스크립트를 사용한 PDF 번역 서비스
 */

const { spawn } = require('child_process');
const path = require('path');

/**
 * arXiv PDF URL 생성
 * @param {string} arxivId - arXiv ID (예: 2401.00001)
 * @returns {string} PDF URL
 */
function getPdfUrl(arxivId) {
    const cleanId = arxivId.replace(/v\d+$/, '');
    return `https://arxiv.org/pdf/${cleanId}.pdf`;
}

/**
 * Python 스크립트를 실행하여 PDF 번역
 * @param {string} arxivId - arXiv 논문 ID
 * @param {string} model - 번역 모델 ('haiku' 또는 'sonnet')
 * @param {Object|null} context - 사전 분석된 맥락 정보 (고급 번역용)
 * @returns {Promise<Object>} 번역 결과
 */
async function translateWithPython(arxivId, model = 'haiku', context = null) {
    return new Promise((resolve, reject) => {
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'translate_paper.py');
        const apiKey = process.env.ANTHROPIC_API_KEY;

        if (!apiKey) {
            return reject(new Error('ANTHROPIC_API_KEY 환경 변수가 설정되지 않았습니다.'));
        }

        console.log(`🐍 Python 번역 스크립트 실행: ${arxivId} (${model})${context ? ' [맥락 주입]' : ''}`);

        // Windows 서버에서는 전체 경로 사용 (IIS 환경에서 PATH가 다를 수 있음)
        const pythonCmd = process.platform === 'win32'
            ? 'C:\\Users\\Administrator\\AppData\\Local\\Programs\\Python\\Python313\\python.exe'
            : 'python3';

        // 기본 인자
        const args = [
            scriptPath,
            arxivId,
            '--model', model,
            '--api-key', apiKey
        ];

        // 고급 번역용 맥락 정보 추가
        if (context && model === 'sonnet') {
            args.push('--context', JSON.stringify(context));
        }

        const pythonProcess = spawn(pythonCmd, args, {
            cwd: path.dirname(scriptPath),
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
        });

        let stdout = '';
        let stderr = '';

        pythonProcess.stdout.on('data', (data) => {
            stdout += data.toString('utf-8');
        });

        pythonProcess.stderr.on('data', (data) => {
            stderr += data.toString('utf-8');
            console.error('Python stderr:', data.toString('utf-8'));
        });

        pythonProcess.on('close', (code) => {
            if (code !== 0) {
                console.error(`Python 스크립트 종료 코드: ${code}`);
                console.error('stderr:', stderr);
                return reject(new Error(`Python 스크립트 실패 (코드: ${code}): ${stderr || stdout}`));
            }

            try {
                // stdout에서 JSON 부분만 추출 (경고 메시지 등이 섞여있을 수 있음)
                let jsonStr = stdout.trim();

                // JSON 시작점 찾기 (첫 번째 '{' 또는 '[')
                const jsonStartIndex = jsonStr.search(/[\{\[]/);
                if (jsonStartIndex > 0) {
                    console.log('JSON 앞에 추가 텍스트 감지, 제거:', jsonStr.substring(0, jsonStartIndex));
                    jsonStr = jsonStr.substring(jsonStartIndex);
                }

                const result = JSON.parse(jsonStr);
                if (result.success) {
                    console.log(`✅ Python 번역 완료: ${result.data.stats.section_count}개 섹션`);
                    resolve(result);
                } else {
                    reject(new Error(result.error || '알 수 없는 오류'));
                }
            } catch (parseError) {
                console.error('JSON 파싱 오류:', stdout.substring(0, 500));
                reject(new Error(`JSON 파싱 실패: ${parseError.message}`));
            }
        });

        pythonProcess.on('error', (err) => {
            reject(new Error(`Python 실행 실패: ${err.message}. Python이 설치되어 있는지 확인하세요.`));
        });

        // 모델별 타임아웃 설정 (haiku: 10분, sonnet: 30분)
        const timeoutMs = model === 'sonnet' ? 1800000 : 600000;
        const timeoutMin = model === 'sonnet' ? 30 : 10;
        setTimeout(() => {
            pythonProcess.kill();
            reject(new Error(`번역 시간 초과 (${timeoutMin}분)`));
        }, timeoutMs);
    });
}

/**
 * 깨진 인코딩 문자 제거
 * @param {string} text - 원본 텍스트
 * @returns {string} 정제된 텍스트
 */
function cleanBrokenEncoding(text) {
    if (!text) return '';

    return text
        // Unicode replacement character (�)
        .replace(/\uFFFD/g, '')
        // Broken surrogate pairs (high surrogate without low surrogate)
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, '')
        // Broken surrogate pairs (low surrogate without high surrogate)
        .replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
        // Private Use Area characters (PDF font encoding artifacts)
        .replace(/[\uE000-\uF8FF]/g, '')
        // Control characters (except newline, tab)
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Various problematic whitespace characters
        .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' ')
        // Multiple spaces to single space
        .replace(/  +/g, ' ')
        // Trim whitespace
        .trim();
}

/**
 * 번역 결과를 통합 텍스트로 변환
 * @param {Object} translationResult - Python 번역 결과
 * @returns {Object} 통합된 번역 데이터
 */
function formatTranslationResult(translationResult) {
    const { data } = translationResult;

    // 섹션별 번역 텍스트 생성
    let translatedText = '';
    let originalText = '';

    // 단락 구조 처리를 위한 배열
    const formattedSections = [];

    for (const section of data.sections) {
        // 깨진 인코딩 정리
        const cleanTitleKo = cleanBrokenEncoding(section.title_ko);
        const cleanTitle = cleanBrokenEncoding(section.title);

        // 새로운 단락 구조 처리 (paragraphs_ko 배열이 있는 경우)
        if (section.paragraphs_ko && Array.isArray(section.paragraphs_ko)) {
            const cleanedParagraphs = section.paragraphs_ko.map(para => ({
                id: para.id,
                text: cleanBrokenEncoding(para.text),
                text_ko: cleanBrokenEncoding(para.text_ko)
            }));

            formattedSections.push({
                title: cleanTitle,
                title_ko: cleanTitleKo,
                paragraphs: cleanedParagraphs,
                page_start: section.page_start,
                page_end: section.page_end
            });

            // 레거시 텍스트 형식 생성
            const sectionTextKo = cleanedParagraphs.map(p => p.text_ko).join('\n\n');
            const sectionText = cleanedParagraphs.map(p => p.text).join('\n\n');
            translatedText += `## ${cleanTitleKo}\n\n${sectionTextKo}\n\n`;
            originalText += `## ${cleanTitle}\n\n${sectionText}\n\n`;
        } else {
            // 레거시 구조 (content/content_ko 문자열)
            const cleanContentKo = cleanBrokenEncoding(section.content_ko);
            const cleanContent = cleanBrokenEncoding(section.content);

            formattedSections.push({
                title: cleanTitle,
                title_ko: cleanTitleKo,
                paragraphs: [{
                    id: 'p0',
                    text: cleanContent,
                    text_ko: cleanContentKo
                }],
                page_start: section.page_start,
                page_end: section.page_end
            });

            translatedText += `## ${cleanTitleKo}\n\n${cleanContentKo}\n\n`;
            originalText += `## ${cleanTitle}\n\n${cleanContent}\n\n`;
        }
    }

    // 기본 결과 구조
    const result = {
        translatedText: translatedText.trim(),
        originalText: originalText.trim(),
        sections: formattedSections,  // 새로운 단락 구조
        rawSections: data.sections,   // 원본 데이터 보존
        metadata: data.metadata,
        images: data.images,
        tables: data.tables,
        sectionCount: data.stats.section_count,
        wordCount: data.stats.word_count,
        tokenCount: data.stats.token_count,
        costUsd: data.stats.cost_usd
    };

    // 고급 번역(Sonnet)인 경우 추가 데이터 포함
    if (data.key_insights) {
        result.key_insights = data.key_insights;
    }
    if (data.terms) {
        result.terms = data.terms;
    }

    return result;
}

/**
 * arXiv 논문 번역 (통합 함수)
 * @param {string} arxivId - arXiv ID
 * @param {string} model - 번역 모델 ('haiku' 또는 'sonnet')
 * @param {Object|null} context - 사전 분석된 맥락 정보 (고급 번역용)
 * @returns {Promise<Object>} 번역 결과
 */
async function translatePaper(arxivId, model = 'haiku', context = null) {
    console.log(`📥 논문 번역 시작: ${arxivId} (${model})${context ? ' [맥락 활용]' : ''}`);

    const result = await translateWithPython(arxivId, model, context);
    const formatted = formatTranslationResult(result);

    console.log(`✅ 번역 완료: ${formatted.sectionCount}개 섹션, ${formatted.wordCount}단어`);

    return formatted;
}

/**
 * 토큰 수 추정 (Claude API용)
 * @param {string} text - 텍스트
 * @returns {number} 추정 토큰 수
 */
function estimateTokens(text) {
    return Math.ceil(text.length / 4);
}

/**
 * 번역 비용 추정
 * @param {number} inputTokens - 입력 토큰 수
 * @param {number} outputTokens - 출력 토큰 수
 * @param {string} model - 모델 ('haiku' 또는 'sonnet')
 * @returns {Object} 비용 정보
 */
function estimateCost(inputTokens, outputTokens, model = 'haiku') {
    const pricing = {
        haiku: {
            input: 0.25 / 1000000,
            output: 1.25 / 1000000
        },
        sonnet: {
            input: 3.00 / 1000000,
            output: 15.00 / 1000000
        }
    };

    const modelPricing = pricing[model] || pricing.haiku;
    const inputCost = inputTokens * modelPricing.input;
    const outputCost = outputTokens * modelPricing.output;
    const totalCost = inputCost + outputCost;

    return {
        model,
        inputTokens,
        outputTokens,
        inputCost,
        outputCost,
        totalCost,
        totalCostKRW: totalCost * 1350
    };
}

module.exports = {
    getPdfUrl,
    translateWithPython,
    formatTranslationResult,
    translatePaper,
    estimateTokens,
    estimateCost
};
