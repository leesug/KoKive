/**
 * KoKive Papers With Code Service
 * GitHub 코드 연동 서비스 (FR-005)
 */

const axios = require('axios');

const PWC_API_BASE = 'https://paperswithcode.com/api/v1';

class PWCService {
    constructor() {
        this.axiosInstance = axios.create({
            baseURL: PWC_API_BASE,
            timeout: 30000,
            headers: {
                'User-Agent': 'KoKive/1.0 (AI Paper Platform)'
            }
        });
    }

    /**
     * arXiv ID로 논문의 GitHub 저장소 조회
     * @param {string} arxivId - arXiv ID
     * @returns {Promise<Object>} - 저장소 정보
     */
    async getRepositoriesByArxivId(arxivId) {
        try {
            // arXiv ID 정규화
            const cleanId = arxivId.replace(/v\d+$/, '');

            // Papers With Code에서 논문 검색
            const searchResponse = await this.axiosInstance.get('/papers/', {
                params: {
                    arxiv_id: cleanId
                }
            });

            if (!searchResponse.data.results || searchResponse.data.results.length === 0) {
                return {
                    found: false,
                    repositories: [],
                    paperUrl: null
                };
            }

            const paper = searchResponse.data.results[0];

            // 해당 논문의 저장소 목록 조회
            const reposResponse = await this.axiosInstance.get(`/papers/${paper.id}/repositories/`);

            const repositories = (reposResponse.data.results || []).map(repo => ({
                url: repo.url,
                owner: this.extractOwner(repo.url),
                name: this.extractRepoName(repo.url),
                stars: repo.stars || 0,
                framework: repo.framework || null,
                isOfficial: repo.is_official || false,
                description: repo.description || null
            }));

            // 별점 순으로 정렬
            repositories.sort((a, b) => b.stars - a.stars);

            return {
                found: true,
                paperId: paper.id,
                paperUrl: `https://paperswithcode.com/paper/${paper.id}`,
                repositories,
                totalCount: repositories.length
            };
        } catch (error) {
            if (error.response?.status === 404) {
                return {
                    found: false,
                    repositories: [],
                    paperUrl: null
                };
            }
            console.error(`PWC API 오류 (${arxivId}):`, error.message);
            throw error;
        }
    }

    /**
     * 논문 제목으로 검색
     * @param {string} title - 논문 제목
     * @returns {Promise<Array>} - 검색 결과
     */
    async searchByTitle(title) {
        try {
            const response = await this.axiosInstance.get('/papers/', {
                params: {
                    q: title,
                    page: 1,
                    items_per_page: 10
                }
            });

            return (response.data.results || []).map(paper => ({
                id: paper.id,
                title: paper.title,
                arxivId: paper.arxiv_id,
                url: `https://paperswithcode.com/paper/${paper.id}`,
                abstract: paper.abstract,
                publishedDate: paper.published,
                repositoryCount: paper.repository_count || 0
            }));
        } catch (error) {
            console.error('PWC 검색 오류:', error.message);
            throw error;
        }
    }

    /**
     * 특정 저장소의 상세 정보 조회
     * @param {string} repoUrl - GitHub 저장소 URL
     * @returns {Promise<Object>} - 저장소 상세 정보
     */
    async getRepositoryDetails(repoUrl) {
        try {
            // GitHub API를 통해 상세 정보 조회
            const match = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
            if (!match) {
                throw new Error('유효하지 않은 GitHub URL입니다.');
            }

            const [, owner, repo] = match;
            const cleanRepo = repo.replace(/\.git$/, '');

            const response = await axios.get(`https://api.github.com/repos/${owner}/${cleanRepo}`, {
                timeout: 10000,
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'KoKive/1.0',
                    ...(process.env.GITHUB_TOKEN && {
                        'Authorization': `token ${process.env.GITHUB_TOKEN}`
                    })
                }
            });

            const data = response.data;

            return {
                url: data.html_url,
                name: data.name,
                fullName: data.full_name,
                owner: data.owner.login,
                description: data.description,
                stars: data.stargazers_count,
                forks: data.forks_count,
                watchers: data.watchers_count,
                language: data.language,
                topics: data.topics || [],
                license: data.license?.spdx_id || null,
                defaultBranch: data.default_branch,
                createdAt: data.created_at,
                updatedAt: data.updated_at,
                pushedAt: data.pushed_at,
                openIssues: data.open_issues_count,
                isArchived: data.archived,
                homepage: data.homepage || null
            };
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            console.error('GitHub API 오류:', error.message);
            throw error;
        }
    }

    /**
     * 논문의 벤치마크/리더보드 정보 조회
     * @param {string} paperId - PWC 논문 ID
     * @returns {Promise<Array>} - 벤치마크 정보
     */
    async getBenchmarks(paperId) {
        try {
            const response = await this.axiosInstance.get(`/papers/${paperId}/results/`);

            return (response.data.results || []).map(result => ({
                task: result.task,
                dataset: result.dataset,
                metric: result.metric,
                value: result.value,
                rank: result.rank,
                evaluatedOn: result.evaluated_date
            }));
        } catch (error) {
            console.error('벤치마크 조회 오류:', error.message);
            return [];
        }
    }

    /**
     * 관련 논문 조회
     * @param {string} paperId - PWC 논문 ID
     * @returns {Promise<Array>} - 관련 논문 목록
     */
    async getRelatedPapers(paperId) {
        try {
            // PWC API에서 관련 논문 조회 (같은 task 기반)
            const paperResponse = await this.axiosInstance.get(`/papers/${paperId}/`);
            const tasks = paperResponse.data.tasks || [];

            if (tasks.length === 0) {
                return [];
            }

            // 첫 번째 task의 논문들 조회
            const taskResponse = await this.axiosInstance.get(`/tasks/${tasks[0]}/papers/`, {
                params: {
                    items_per_page: 10
                }
            });

            return (taskResponse.data.results || [])
                .filter(p => p.id !== paperId)
                .map(paper => ({
                    id: paper.id,
                    title: paper.title,
                    arxivId: paper.arxiv_id,
                    url: `https://paperswithcode.com/paper/${paper.id}`,
                    publishedDate: paper.published
                }));
        } catch (error) {
            console.error('관련 논문 조회 오류:', error.message);
            return [];
        }
    }

    /**
     * 트렌딩 논문 조회
     * @param {number} limit - 조회 개수
     * @returns {Promise<Array>} - 트렌딩 논문 목록
     */
    async getTrendingPapers(limit = 20) {
        try {
            const response = await this.axiosInstance.get('/papers/', {
                params: {
                    ordering: '-github_stars',
                    items_per_page: limit
                }
            });

            return (response.data.results || []).map(paper => ({
                id: paper.id,
                title: paper.title,
                arxivId: paper.arxiv_id,
                url: `https://paperswithcode.com/paper/${paper.id}`,
                abstract: paper.abstract?.substring(0, 300),
                publishedDate: paper.published,
                repositoryCount: paper.repository_count || 0
            }));
        } catch (error) {
            console.error('트렌딩 논문 조회 오류:', error.message);
            return [];
        }
    }

    // ==========================================
    // Helper Methods
    // ==========================================

    /**
     * GitHub URL에서 owner 추출
     */
    extractOwner(url) {
        const match = url.match(/github\.com\/([^\/]+)/);
        return match ? match[1] : null;
    }

    /**
     * GitHub URL에서 repo name 추출
     */
    extractRepoName(url) {
        const match = url.match(/github\.com\/[^\/]+\/([^\/]+)/);
        return match ? match[1].replace(/\.git$/, '') : null;
    }
}

module.exports = new PWCService();
