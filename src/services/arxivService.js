/**
 * KoKive arXiv Service
 * arXiv API 연동 서비스 (FR-001)
 */

const axios = require('axios');
const xml2js = require('xml2js');
const { PAPER_CATEGORIES } = require('../config/constants');

const ARXIV_API_BASE = 'http://export.arxiv.org/api/query';

class ArxivService {
    constructor() {
        this.parser = new xml2js.Parser({
            explicitArray: false,
            ignoreAttrs: false,
            tagNameProcessors: [xml2js.processors.stripPrefix]
        });
    }

    /**
     * 카테고리별 최신 논문 수집
     * @param {string} category - arXiv 카테고리 (e.g., 'cs.AI', 'cs.LG')
     * @param {number} maxResults - 최대 결과 수
     * @param {number} start - 시작 인덱스
     * @returns {Promise<Array>} - 논문 목록
     */
    async fetchPapersByCategory(category, maxResults = 50, start = 0) {
        try {
            const searchQuery = `cat:${category}`;
            const url = `${ARXIV_API_BASE}?search_query=${encodeURIComponent(searchQuery)}&start=${start}&max_results=${maxResults}&sortBy=submittedDate&sortOrder=descending`;

            const response = await axios.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'KoKive/1.0 (AI Paper Platform)'
                }
            });

            const result = await this.parser.parseStringPromise(response.data);
            return this.parseEntries(result.feed?.entry || []);
        } catch (error) {
            console.error(`arXiv API 오류 (${category}):`, error.message);
            throw error;
        }
    }

    /**
     * arXiv ID로 논문 조회
     * @param {string} arxivId - arXiv ID
     * @returns {Promise<Object>} - 논문 정보
     */
    async fetchPaperById(arxivId) {
        try {
            // arXiv ID 정규화 (버전 제거)
            const cleanId = arxivId.replace(/v\d+$/, '');
            const url = `${ARXIV_API_BASE}?id_list=${cleanId}`;

            const response = await axios.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'KoKive/1.0 (AI Paper Platform)'
                }
            });

            const result = await this.parser.parseStringPromise(response.data);
            const entries = this.parseEntries(result.feed?.entry || []);

            if (entries.length === 0) {
                throw new Error(`논문을 찾을 수 없음: ${arxivId}`);
            }

            return entries[0];
        } catch (error) {
            console.error(`arXiv 논문 조회 오류 (${arxivId}):`, error.message);
            throw error;
        }
    }

    /**
     * 키워드로 논문 검색
     * @param {string} query - 검색어
     * @param {Object} options - 검색 옵션
     * @returns {Promise<Array>} - 논문 목록
     */
    async searchPapers(query, options = {}) {
        try {
            const {
                maxResults = 20,
                start = 0,
                categories = [],
                dateFrom,
                dateTo
            } = options;

            // 검색 쿼리 구성
            let searchQuery = `all:${query}`;

            // 카테고리 필터
            if (categories.length > 0) {
                const catQuery = categories.map(c => `cat:${c}`).join('+OR+');
                searchQuery = `(${searchQuery})+AND+(${catQuery})`;
            }

            const url = `${ARXIV_API_BASE}?search_query=${encodeURIComponent(searchQuery)}&start=${start}&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

            const response = await axios.get(url, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'KoKive/1.0 (AI Paper Platform)'
                }
            });

            const result = await this.parser.parseStringPromise(response.data);
            let papers = this.parseEntries(result.feed?.entry || []);

            // 날짜 필터링 (arXiv API는 날짜 필터를 직접 지원하지 않음)
            if (dateFrom || dateTo) {
                papers = papers.filter(paper => {
                    const publishDate = new Date(paper.publishedAt);
                    if (dateFrom && publishDate < new Date(dateFrom)) return false;
                    if (dateTo && publishDate > new Date(dateTo)) return false;
                    return true;
                });
            }

            return papers;
        } catch (error) {
            console.error('arXiv 검색 오류:', error.message);
            throw error;
        }
    }

    /**
     * 여러 카테고리의 최신 논문 수집
     * @param {Array<string>} categories - 카테고리 목록
     * @param {number} papersPerCategory - 카테고리당 논문 수
     * @returns {Promise<Array>} - 논문 목록
     */
    async fetchLatestPapers(categories = null, papersPerCategory = 20) {
        const targetCategories = categories || Object.values(PAPER_CATEGORIES);
        const allPapers = [];
        const seenIds = new Set();

        for (const category of targetCategories) {
            try {
                // API 속도 제한을 위한 딜레이
                await this.delay(1000);

                const papers = await this.fetchPapersByCategory(category, papersPerCategory);

                for (const paper of papers) {
                    if (!seenIds.has(paper.arxivId)) {
                        seenIds.add(paper.arxivId);
                        allPapers.push(paper);
                    }
                }

                console.log(`✅ ${category}: ${papers.length}개 논문 수집`);
            } catch (error) {
                console.error(`❌ ${category}: 수집 실패 - ${error.message}`);
            }
        }

        return allPapers;
    }

    /**
     * arXiv 응답 엔트리 파싱
     * @param {Array|Object} entries - 원시 엔트리 데이터
     * @returns {Array} - 파싱된 논문 목록
     */
    parseEntries(entries) {
        if (!entries) return [];
        const entryArray = Array.isArray(entries) ? entries : [entries];

        return entryArray.map(entry => this.parseEntry(entry)).filter(Boolean);
    }

    /**
     * 단일 엔트리 파싱
     */
    parseEntry(entry) {
        try {
            // arXiv ID 추출
            const idMatch = entry.id?.match(/abs\/(.+)$/);
            if (!idMatch) return null;

            const arxivId = idMatch[1].replace(/v\d+$/, ''); // 버전 제거

            // 저자 파싱
            const authors = this.parseAuthors(entry.author);

            // 카테고리 파싱
            const categories = this.parseCategories(entry.category);

            // PDF URL 추출
            const links = Array.isArray(entry.link) ? entry.link : [entry.link].filter(Boolean);
            const pdfLink = links.find(l => l.$?.title === 'pdf' || l.$?.type === 'application/pdf');

            return {
                arxivId,
                titleEn: this.cleanText(entry.title),
                abstractEn: this.cleanText(entry.summary),
                authors,
                primaryCategory: categories[0] || 'cs.AI',
                categories,
                publishedAt: entry.published ? new Date(entry.published) : null,
                updatedAt: entry.updated ? new Date(entry.updated) : null,
                pdfUrl: pdfLink?.$?.href || `https://arxiv.org/pdf/${arxivId}.pdf`,
                arxivUrl: `https://arxiv.org/abs/${arxivId}`,
                comment: entry['arxiv:comment']?._ || entry.comment || null,
                journalRef: entry['arxiv:journal_ref']?._ || entry.journal_ref || null,
                doi: entry['arxiv:doi']?._ || entry.doi || null
            };
        } catch (error) {
            console.error('엔트리 파싱 오류:', error.message);
            return null;
        }
    }

    /**
     * 저자 파싱
     */
    parseAuthors(authorData) {
        if (!authorData) return [];

        const authors = Array.isArray(authorData) ? authorData : [authorData];

        return authors.map(author => {
            const name = author.name || author;
            if (typeof name === 'string') {
                const parts = name.trim().split(' ');
                return {
                    name: name.trim(),
                    firstName: parts.slice(0, -1).join(' '),
                    lastName: parts[parts.length - 1],
                    affiliation: author.affiliation?._ || author.affiliation || null
                };
            }
            return {
                name: 'Unknown',
                firstName: '',
                lastName: 'Unknown',
                affiliation: null
            };
        });
    }

    /**
     * 카테고리 파싱
     */
    parseCategories(categoryData) {
        if (!categoryData) return [];

        const categories = Array.isArray(categoryData) ? categoryData : [categoryData];

        return categories
            .map(cat => cat.$?.term || cat.term || cat)
            .filter(Boolean);
    }

    /**
     * 텍스트 정리 (줄바꿈, 공백 정리)
     */
    cleanText(text) {
        if (!text) return '';
        return text
            .replace(/\s+/g, ' ')
            .replace(/\n/g, ' ')
            .trim();
    }

    /**
     * 딜레이 유틸리티
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * PDF 다운로드 URL 생성
     */
    getPdfUrl(arxivId) {
        const cleanId = arxivId.replace(/v\d+$/, '');
        return `https://arxiv.org/pdf/${cleanId}.pdf`;
    }

    /**
     * Abstract 페이지 URL 생성
     */
    getAbsUrl(arxivId) {
        const cleanId = arxivId.replace(/v\d+$/, '');
        return `https://arxiv.org/abs/${cleanId}`;
    }
}

module.exports = new ArxivService();
