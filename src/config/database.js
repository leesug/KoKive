/**
 * KoKive Database Configuration
 * MySQL 연결 풀 및 유틸리티
 */

const mysql = require('mysql2/promise');

// 환경변수에서 설정 로드
const dbConfig = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kokive',
    waitForConnections: true,
    connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT) || 10,
    queueLimit: 0,
    charset: 'utf8mb4',
    timezone: '+09:00',
    // JSON 자동 파싱
    typeCast: function (field, next) {
        if (field.type === 'JSON') {
            return JSON.parse(field.string());
        }
        return next();
    }
};

// 연결 풀 생성
const pool = mysql.createPool(dbConfig);

/**
 * 데이터베이스 연결 테스트
 */
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log('✅ MySQL 연결 성공');
        console.log(`   데이터베이스: ${dbConfig.database}`);
        console.log(`   호스트: ${dbConfig.host}:${dbConfig.port}`);
        connection.release();
        return true;
    } catch (error) {
        console.error('❌ MySQL 연결 실패:', error.message);
        return false;
    }
}

/**
 * 쿼리 실행 헬퍼
 * @param {string} sql - SQL 쿼리
 * @param {Array} params - 파라미터 배열
 * @returns {Promise<Array>} 쿼리 결과
 */
async function query(sql, params = []) {
    const [results] = await pool.query(sql, params);
    return results;
}

/**
 * 단일 행 조회 헬퍼
 * @param {string} sql - SQL 쿼리
 * @param {Array} params - 파라미터 배열
 * @returns {Promise<Object|null>} 단일 행 또는 null
 */
async function queryOne(sql, params = []) {
    const results = await query(sql, params);
    return results[0] || null;
}

/**
 * INSERT 실행 헬퍼
 * @param {string} table - 테이블명
 * @param {Object} data - 삽입할 데이터 객체
 * @returns {Promise<number>} 삽입된 ID
 */
async function insert(table, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map(() => '?').join(', ');

    const sql = `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
    const [result] = await pool.query(sql, values);
    return result.insertId;
}

/**
 * UPDATE 실행 헬퍼
 * @param {string} table - 테이블명
 * @param {Object} data - 업데이트할 데이터 객체
 * @param {Object} where - WHERE 조건 객체
 * @returns {Promise<number>} 영향받은 행 수
 */
async function update(table, data, where) {
    const setKeys = Object.keys(data);
    const setValues = Object.values(data);
    const setClause = setKeys.map(key => `${key} = ?`).join(', ');

    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereClause = whereKeys.map(key => `${key} = ?`).join(' AND ');

    const sql = `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`;
    const [result] = await pool.query(sql, [...setValues, ...whereValues]);
    return result.affectedRows;
}

/**
 * DELETE 실행 헬퍼
 * @param {string} table - 테이블명
 * @param {Object} where - WHERE 조건 객체
 * @returns {Promise<number>} 삭제된 행 수
 */
async function remove(table, where) {
    const whereKeys = Object.keys(where);
    const whereValues = Object.values(where);
    const whereClause = whereKeys.map(key => `${key} = ?`).join(' AND ');

    const sql = `DELETE FROM ${table} WHERE ${whereClause}`;
    const [result] = await pool.query(sql, whereValues);
    return result.affectedRows;
}

/**
 * 트랜잭션 실행 헬퍼
 * @param {Function} callback - 트랜잭션 내에서 실행할 함수
 * @returns {Promise<any>} 콜백 반환값
 */
async function transaction(callback) {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

/**
 * 페이지네이션 헬퍼
 * @param {string} sql - 기본 SQL 쿼리 (ORDER BY 전까지)
 * @param {Array} params - 쿼리 파라미터
 * @param {Object} options - 페이지네이션 옵션
 * @returns {Promise<Object>} 페이지네이션 결과
 */
async function paginate(sql, params, { page = 1, limit = 20, orderBy = 'id DESC' }) {
    const offset = (page - 1) * limit;

    // 전체 개수 조회
    const countSql = `SELECT COUNT(*) as total FROM (${sql}) as count_query`;
    const [countResult] = await pool.query(countSql, params);
    const total = countResult[0].total;

    // 페이지네이션 적용 쿼리
    const paginatedSql = `${sql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    const [items] = await pool.query(paginatedSql, [...params, limit, offset]);

    return {
        items,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
            hasNext: page * limit < total,
            hasPrev: page > 1
        }
    };
}

module.exports = {
    pool,
    testConnection,
    query,
    queryOne,
    insert,
    update,
    remove,
    transaction,
    paginate
};
