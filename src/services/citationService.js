/**
 * KoKive Citation Service
 * 인용 형식 생성 서비스 (FR-008)
 */

const { CITATION_FORMATS } = require('../config/constants');

/**
 * 논문 데이터로부터 인용 형식 생성
 */
class CitationService {
    /**
     * 모든 지원 형식으로 인용 생성
     * @param {Object} paper - 논문 데이터
     * @returns {Object} - 형식별 인용 문자열
     */
    generateAllFormats(paper) {
        return {
            bibtex: this.generateBibTeX(paper),
            apa: this.generateAPA(paper),
            mla: this.generateMLA(paper),
            chicago: this.generateChicago(paper),
            harvard: this.generateHarvard(paper),
            ieee: this.generateIEEE(paper),
            vancouver: this.generateVancouver(paper)
        };
    }

    /**
     * 특정 형식으로 인용 생성
     * @param {Object} paper - 논문 데이터
     * @param {string} format - 인용 형식
     * @returns {string} - 인용 문자열
     */
    generateCitation(paper, format) {
        switch (format.toLowerCase()) {
            case CITATION_FORMATS.BIBTEX:
                return this.generateBibTeX(paper);
            case CITATION_FORMATS.APA:
                return this.generateAPA(paper);
            case CITATION_FORMATS.MLA:
                return this.generateMLA(paper);
            case CITATION_FORMATS.CHICAGO:
                return this.generateChicago(paper);
            case CITATION_FORMATS.HARVARD:
                return this.generateHarvard(paper);
            case CITATION_FORMATS.IEEE:
                return this.generateIEEE(paper);
            case CITATION_FORMATS.VANCOUVER:
                return this.generateVancouver(paper);
            default:
                throw new Error(`지원하지 않는 인용 형식: ${format}`);
        }
    }

    /**
     * BibTeX 형식
     */
    generateBibTeX(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = authors.map(a => `${a.lastName}, ${a.firstName}`).join(' and ');
        const year = this.getYear(paper.published_at);
        const citeKey = this.generateCiteKey(paper, authors, year);

        return `@article{${citeKey},
    title = {${this.escapeLatex(paper.title_en || paper.title_ko)}},
    author = {${authorStr}},
    journal = {arXiv preprint arXiv:${paper.arxiv_id}},
    year = {${year}},
    eprint = {${paper.arxiv_id}},
    archivePrefix = {arXiv},
    primaryClass = {${paper.primary_category || 'cs.AI'}}
}`;
    }

    /**
     * APA 7th Edition 형식
     */
    generateAPA(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = this.formatAuthorsAPA(authors);
        const year = this.getYear(paper.published_at);
        const title = paper.title_en || paper.title_ko;

        return `${authorStr} (${year}). ${title}. arXiv. https://arxiv.org/abs/${paper.arxiv_id}`;
    }

    /**
     * MLA 9th Edition 형식
     */
    generateMLA(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = this.formatAuthorsMLA(authors);
        const title = paper.title_en || paper.title_ko;
        const year = this.getYear(paper.published_at);

        return `${authorStr}. "${title}." arXiv, ${year}, https://arxiv.org/abs/${paper.arxiv_id}.`;
    }

    /**
     * Chicago 형식 (Author-Date)
     */
    generateChicago(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = this.formatAuthorsChicago(authors);
        const year = this.getYear(paper.published_at);
        const title = paper.title_en || paper.title_ko;

        return `${authorStr}. ${year}. "${title}." arXiv. https://arxiv.org/abs/${paper.arxiv_id}.`;
    }

    /**
     * Harvard 형식
     */
    generateHarvard(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = this.formatAuthorsHarvard(authors);
        const year = this.getYear(paper.published_at);
        const title = paper.title_en || paper.title_ko;

        return `${authorStr} (${year}) '${title}', arXiv preprint arXiv:${paper.arxiv_id}. Available at: https://arxiv.org/abs/${paper.arxiv_id}.`;
    }

    /**
     * IEEE 형식
     */
    generateIEEE(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = this.formatAuthorsIEEE(authors);
        const title = paper.title_en || paper.title_ko;
        const year = this.getYear(paper.published_at);

        return `${authorStr}, "${title}," arXiv preprint arXiv:${paper.arxiv_id}, ${year}.`;
    }

    /**
     * Vancouver 형식
     */
    generateVancouver(paper) {
        const authors = this.parseAuthors(paper.authors);
        const authorStr = this.formatAuthorsVancouver(authors);
        const title = paper.title_en || paper.title_ko;
        const year = this.getYear(paper.published_at);

        return `${authorStr}. ${title}. arXiv preprint arXiv:${paper.arxiv_id}. ${year}.`;
    }

    // ==========================================
    // Helper Methods
    // ==========================================

    /**
     * 저자 문자열 파싱
     */
    parseAuthors(authorsInput) {
        if (!authorsInput) return [{ firstName: 'Unknown', lastName: 'Author' }];

        let authors;
        if (typeof authorsInput === 'string') {
            try {
                authors = JSON.parse(authorsInput);
            } catch {
                // 쉼표로 구분된 문자열로 가정
                authors = authorsInput.split(',').map(name => {
                    const parts = name.trim().split(' ');
                    if (parts.length === 1) {
                        return { firstName: '', lastName: parts[0] };
                    }
                    return {
                        firstName: parts.slice(0, -1).join(' '),
                        lastName: parts[parts.length - 1]
                    };
                });
            }
        } else if (Array.isArray(authorsInput)) {
            authors = authorsInput.map(author => {
                if (typeof author === 'string') {
                    const parts = author.trim().split(' ');
                    if (parts.length === 1) {
                        return { firstName: '', lastName: parts[0] };
                    }
                    return {
                        firstName: parts.slice(0, -1).join(' '),
                        lastName: parts[parts.length - 1]
                    };
                }
                return author;
            });
        } else {
            authors = [{ firstName: 'Unknown', lastName: 'Author' }];
        }

        return authors;
    }

    /**
     * 연도 추출
     */
    getYear(dateInput) {
        if (!dateInput) return new Date().getFullYear();
        const date = new Date(dateInput);
        return date.getFullYear();
    }

    /**
     * BibTeX cite key 생성
     */
    generateCiteKey(paper, authors, year) {
        const firstAuthorLastName = authors[0]?.lastName?.toLowerCase().replace(/[^a-z]/g, '') || 'unknown';
        const firstWord = (paper.title_en || paper.title_ko || '')
            .split(' ')[0]
            .toLowerCase()
            .replace(/[^a-z]/g, '') || 'paper';
        return `${firstAuthorLastName}${year}${firstWord}`;
    }

    /**
     * LaTeX 특수문자 이스케이프
     */
    escapeLatex(text) {
        if (!text) return '';
        return text
            .replace(/\\/g, '\\textbackslash{}')
            .replace(/[&%$#_{}]/g, '\\$&')
            .replace(/~/g, '\\textasciitilde{}')
            .replace(/\^/g, '\\textasciicircum{}');
    }

    /**
     * APA 형식 저자 포맷팅
     */
    formatAuthorsAPA(authors) {
        if (authors.length === 0) return 'Unknown Author';
        if (authors.length === 1) {
            return `${authors[0].lastName}, ${this.getInitials(authors[0].firstName)}`;
        }
        if (authors.length === 2) {
            return `${authors[0].lastName}, ${this.getInitials(authors[0].firstName)}, & ${authors[1].lastName}, ${this.getInitials(authors[1].firstName)}`;
        }
        if (authors.length <= 20) {
            const allButLast = authors.slice(0, -1).map(a => `${a.lastName}, ${this.getInitials(a.firstName)}`).join(', ');
            const last = authors[authors.length - 1];
            return `${allButLast}, & ${last.lastName}, ${this.getInitials(last.firstName)}`;
        }
        // 20명 이상
        const first19 = authors.slice(0, 19).map(a => `${a.lastName}, ${this.getInitials(a.firstName)}`).join(', ');
        const last = authors[authors.length - 1];
        return `${first19}, ... ${last.lastName}, ${this.getInitials(last.firstName)}`;
    }

    /**
     * MLA 형식 저자 포맷팅
     */
    formatAuthorsMLA(authors) {
        if (authors.length === 0) return 'Unknown Author';
        if (authors.length === 1) {
            return `${authors[0].lastName}, ${authors[0].firstName}`;
        }
        if (authors.length === 2) {
            return `${authors[0].lastName}, ${authors[0].firstName}, and ${authors[1].firstName} ${authors[1].lastName}`;
        }
        return `${authors[0].lastName}, ${authors[0].firstName}, et al`;
    }

    /**
     * Chicago 형식 저자 포맷팅
     */
    formatAuthorsChicago(authors) {
        if (authors.length === 0) return 'Unknown Author';
        if (authors.length === 1) {
            return `${authors[0].lastName}, ${authors[0].firstName}`;
        }
        if (authors.length <= 3) {
            const allButLast = authors.slice(0, -1).map(a => `${a.lastName}, ${a.firstName}`).join(', ');
            const last = authors[authors.length - 1];
            return `${allButLast}, and ${last.firstName} ${last.lastName}`;
        }
        return `${authors[0].lastName}, ${authors[0].firstName}, et al`;
    }

    /**
     * Harvard 형식 저자 포맷팅
     */
    formatAuthorsHarvard(authors) {
        if (authors.length === 0) return 'Unknown Author';
        if (authors.length === 1) {
            return `${authors[0].lastName}, ${this.getInitials(authors[0].firstName)}`;
        }
        if (authors.length === 2) {
            return `${authors[0].lastName}, ${this.getInitials(authors[0].firstName)} and ${authors[1].lastName}, ${this.getInitials(authors[1].firstName)}`;
        }
        if (authors.length <= 3) {
            const allButLast = authors.slice(0, -1).map(a => `${a.lastName}, ${this.getInitials(a.firstName)}`).join(', ');
            const last = authors[authors.length - 1];
            return `${allButLast} and ${last.lastName}, ${this.getInitials(last.firstName)}`;
        }
        return `${authors[0].lastName}, ${this.getInitials(authors[0].firstName)} et al.`;
    }

    /**
     * IEEE 형식 저자 포맷팅
     */
    formatAuthorsIEEE(authors) {
        if (authors.length === 0) return 'Unknown Author';
        if (authors.length === 1) {
            return `${this.getInitials(authors[0].firstName)} ${authors[0].lastName}`;
        }
        if (authors.length === 2) {
            return `${this.getInitials(authors[0].firstName)} ${authors[0].lastName} and ${this.getInitials(authors[1].firstName)} ${authors[1].lastName}`;
        }
        const allButLast = authors.slice(0, -1).map(a => `${this.getInitials(a.firstName)} ${a.lastName}`).join(', ');
        const last = authors[authors.length - 1];
        return `${allButLast}, and ${this.getInitials(last.firstName)} ${last.lastName}`;
    }

    /**
     * Vancouver 형식 저자 포맷팅
     */
    formatAuthorsVancouver(authors) {
        if (authors.length === 0) return 'Unknown Author';
        if (authors.length <= 6) {
            return authors.map(a => `${a.lastName} ${this.getInitials(a.firstName).replace(/\./g, '')}`).join(', ');
        }
        const first6 = authors.slice(0, 6).map(a => `${a.lastName} ${this.getInitials(a.firstName).replace(/\./g, '')}`).join(', ');
        return `${first6}, et al`;
    }

    /**
     * 이름에서 이니셜 추출
     */
    getInitials(firstName) {
        if (!firstName) return '';
        return firstName
            .split(' ')
            .map(part => part.charAt(0).toUpperCase() + '.')
            .join(' ');
    }
}

module.exports = new CitationService();
