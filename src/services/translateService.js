/**
 * Google Translate Service (Free)
 * 무료 Google Translate API를 사용한 번역 서비스
 */

const https = require('https');
const http = require('http');

class TranslateService {
    constructor() {
        this.baseUrl = 'translate.googleapis.com';
        this.rateLimitDelay = 500; // 요청 간 딜레이 (ms)
        this.maxRetries = 3;
        this.lastRequestTime = 0;
    }

    /**
     * 텍스트를 한국어로 번역
     * @param {string} text - 번역할 텍스트
     * @param {string} sourceLang - 원본 언어 (기본: en)
     * @returns {Promise<string>} 번역된 텍스트
     */
    async translateToKorean(text, sourceLang = 'en') {
        if (!text || text.trim() === '') {
            return '';
        }

        // 이미 한글이 포함되어 있으면 번역하지 않음
        if (/[가-힣]/.test(text)) {
            return text;
        }

        // Rate limiting
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            await this.delay(this.rateLimitDelay - timeSinceLastRequest);
        }

        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const result = await this._translate(text, sourceLang, 'ko');
                this.lastRequestTime = Date.now();
                return result;
            } catch (error) {
                console.error(`번역 시도 ${attempt}/${this.maxRetries} 실패:`, error.message);
                if (attempt < this.maxRetries) {
                    await this.delay(1000 * attempt); // 재시도 시 대기 시간 증가
                } else {
                    console.error('번역 최종 실패, 원본 텍스트 반환');
                    return text; // 실패 시 원본 반환
                }
            }
        }
        return text;
    }

    /**
     * 여러 텍스트를 한 번에 번역
     * @param {Object} texts - { title: '...', abstract: '...' }
     * @returns {Promise<Object>} 번역된 텍스트들
     */
    async translateMultiple(texts) {
        const result = {};
        for (const [key, value] of Object.entries(texts)) {
            if (value && value.trim()) {
                result[key] = await this.translateToKorean(value);
                await this.delay(300); // 각 번역 사이 딜레이
            } else {
                result[key] = value;
            }
        }
        return result;
    }

    /**
     * 논문 제목과 초록 번역
     * @param {Object} paper - { titleEn, abstractEn }
     * @returns {Promise<Object>} { titleKo, abstractKo }
     */
    async translatePaper(paper) {
        const result = {
            titleKo: null,
            abstractKo: null
        };

        try {
            if (paper.titleEn) {
                result.titleKo = await this.translateToKorean(paper.titleEn);
                console.log(`제목 번역 완료: ${paper.titleEn.substring(0, 50)}...`);
            }
        } catch (error) {
            console.error('제목 번역 실패:', error.message);
        }

        await this.delay(500);

        try {
            if (paper.abstractEn) {
                // 초록이 너무 길면 나눠서 번역
                if (paper.abstractEn.length > 4000) {
                    result.abstractKo = await this._translateLongText(paper.abstractEn);
                } else {
                    result.abstractKo = await this.translateToKorean(paper.abstractEn);
                }
                console.log(`초록 번역 완료: ${paper.abstractEn.substring(0, 50)}...`);
            }
        } catch (error) {
            console.error('초록 번역 실패:', error.message);
        }

        return result;
    }

    /**
     * 긴 텍스트를 나눠서 번역
     */
    async _translateLongText(text, maxChunkSize = 4000) {
        const sentences = text.split(/(?<=[.!?])\s+/);
        const chunks = [];
        let currentChunk = '';

        for (const sentence of sentences) {
            if ((currentChunk + ' ' + sentence).length > maxChunkSize) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                }
                currentChunk = sentence;
            } else {
                currentChunk += ' ' + sentence;
            }
        }
        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        const translatedChunks = [];
        for (const chunk of chunks) {
            const translated = await this.translateToKorean(chunk);
            translatedChunks.push(translated);
            await this.delay(500);
        }

        return translatedChunks.join(' ');
    }

    /**
     * Google Translate API 호출 (무료 버전)
     */
    _translate(text, sourceLang, targetLang) {
        return new Promise((resolve, reject) => {
            const encodedText = encodeURIComponent(text);
            const path = `/translate_a/single?client=gtx&sl=${sourceLang}&tl=${targetLang}&dt=t&q=${encodedText}`;

            const options = {
                hostname: this.baseUrl,
                port: 443,
                path: path,
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => {
                    data += chunk;
                });
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        if (parsed && parsed[0]) {
                            const translated = parsed[0]
                                .filter(item => item && item[0])
                                .map(item => item[0])
                                .join('');
                            resolve(translated);
                        } else {
                            reject(new Error('Invalid response format'));
                        }
                    } catch (error) {
                        reject(new Error('Failed to parse response: ' + error.message));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.setTimeout(10000, () => {
                req.destroy();
                reject(new Error('Request timeout'));
            });

            req.end();
        });
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new TranslateService();
