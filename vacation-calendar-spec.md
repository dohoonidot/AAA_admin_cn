# 휴가 캘린더 컴포넌트 - React 이식용 스펙

## 개요
월별 달력에 전사원 휴가 일정을 표시하는 캘린더 뷰.
외부 라이브러리 없이 순수 CSS Grid + JS로 구현되어 있으며, React 컴포넌트로 변환하여 사용할 수 있음.

---

## 1. API 스펙

### 1-1. 휴가 데이터 조회

```
POST /admin/leave/management/history?page=1&page_size=500
Content-Type: application/json
```

**Request Body:**
```json
{
  "year": 2026
}
```

**Response:**
```json
{
  "leaves": [
    {
      "id": 41015,
      "name": "김도훈",
      "department": "Biz AI사업부",
      "job_position": "위원",
      "leave_type": "연차",
      "start_date": "2026-02-19T09:00:00Z",
      "end_date": "2026-02-20T18:00:00Z",
      "status": "APPROVED",
      "workdays_count": 2,
      "requested_date": "2026-01-30T17:35:36Z",
      "user_id": "dohun927@aspnc.com",
      "year": 2026
    }
  ],
  "total_pages": 1
}
```

> **중요:** `start_date`, `end_date`는 UTC(Z suffix)로 내려오며, 타임존 변환 없이 UTC 값 그대로 사용해야 함. `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` 사용 필수.

### 1-2. 부서 목록 조회 (필터용)

```
GET /api/getDepartmentList
```

**Response:**
```json
{
  "departments": ["경영관리실", "Biz AI사업부", "솔루션사업부", ...]
}
```

---

## 2. CSS (그대로 사용 가능)

```css
/* ===== 캘린더 컨테이너 ===== */
.calendar-container {
    background: #fff;
    border-radius: 12px;
    border: 1px solid #e5e7eb;
    overflow: hidden;
}

/* ===== 상단 네비게이션 (이전/다음 월) ===== */
.calendar-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
}
.calendar-nav h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 700;
    color: #1a1f36;
}
.calendar-nav button {
    background: #fff;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    padding: 6px 14px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    color: #374151;
    transition: all 0.15s;
}
.calendar-nav button:hover {
    background: #f3f4f6;
    border-color: #9ca3af;
}

/* ===== 달력 7열 그리드 ===== */
.calendar-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
}

/* ===== 요일 헤더 (일~토) ===== */
.calendar-header-cell {
    padding: 10px 4px;
    text-align: center;
    font-size: 12px;
    font-weight: 600;
    color: #6b7280;
    background: #f9fafb;
    border-bottom: 1px solid #e5e7eb;
}
.calendar-header-cell:nth-child(1) { color: #ef4444; }  /* 일요일 빨강 */
.calendar-header-cell:nth-child(7) { color: #3b82f6; }  /* 토요일 파랑 */

/* ===== 날짜 셀 ===== */
.calendar-cell {
    min-height: 100px;
    padding: 4px;
    border-right: 1px solid #f3f4f6;
    border-bottom: 1px solid #f3f4f6;
    position: relative;
    cursor: default;
}
.calendar-cell:nth-child(7n) { border-right: none; }
.calendar-cell.other-month { background: #fafafa; }
.calendar-cell.today { background: #eff6ff; }

/* ===== 날짜 숫자 ===== */
.calendar-date {
    font-size: 12px;
    font-weight: 600;
    color: #374151;
    padding: 2px 6px;
    display: inline-block;
}
.calendar-cell.other-month .calendar-date { color: #d1d5db; }
.calendar-cell:nth-child(7n+1) .calendar-date { color: #ef4444; }  /* 일요일 */
.calendar-cell:nth-child(7n) .calendar-date { color: #3b82f6; }    /* 토요일 */
.calendar-cell.today .calendar-date {
    background: #3b82f6;
    color: #fff;
    border-radius: 50%;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
}

/* ===== 휴가 태그 (셀 안에 표시) ===== */
.leave-tag {
    display: block;
    padding: 2px 6px;
    margin: 1px 2px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: pointer;
}
.leave-tag:hover { opacity: 0.85; }

/* 휴가 유형별 색상 */
.leave-tag.type-annual  { background: #dbeafe; color: #1e40af; }  /* 연차 - 파랑 */
.leave-tag.type-sick    { background: #fef3c7; color: #92400e; }  /* 병가 - 노랑 */
.leave-tag.type-special { background: #e0e7ff; color: #3730a3; }  /* 경조사/예비군 - 보라 */
.leave-tag.type-other   { background: #f3f4f6; color: #374151; }  /* 기타 - 회색 */

/* ===== +N건 더보기 ===== */
.leave-more {
    font-size: 11px;
    color: #6b7280;
    padding: 1px 6px;
    cursor: pointer;
    font-weight: 500;
}
.leave-more:hover { color: #3b82f6; }

/* ===== 날짜 클릭 상세 모달 ===== */
.day-modal {
    display: none;
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.4);
    z-index: 1000;
    justify-content: center;
    align-items: center;
}
.day-modal-content {
    background: #fff;
    border-radius: 12px;
    width: 90%;
    max-width: 500px;
    max-height: 70vh;
    overflow-y: auto;
    padding: 24px;
}
.day-modal-content h3 {
    margin: 0 0 16px 0;
    font-size: 16px;
    font-weight: 700;
}
.day-leave-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 10px 12px;
    border-bottom: 1px solid #f3f4f6;
}
.day-leave-item:last-child { border-bottom: none; }
```

---

## 3. 핵심 로직 (JS → React 변환 시 참고)

### 3-1. 휴가 유형 → CSS 클래스 매핑

```javascript
function getLeaveTypeClass(type) {
    if (!type) return 'type-other';
    if (type.includes('연차')) return 'type-annual';
    if (type.includes('병가')) return 'type-sick';
    if (type.includes('경조') || type.includes('예비군') || type.includes('민방위')) return 'type-special';
    return 'type-other';
}
```

### 3-2. 특정 날짜에 해당하는 휴가 필터링 + 가나다순 정렬

```javascript
// dateStr 형식: "2026-02-19"
// leaveData: API에서 받은 leaves 배열
// dept: 부서 필터 값 (빈 문자열이면 전체)
// nameKeyword: 이름 검색어 (빈 문자열이면 전체)
function getLeavesForDate(dateStr, leaveData, dept, nameKeyword) {
    return leaveData.filter(l => {
        const start = new Date(l.start_date);
        const end = new Date(l.end_date);
        // UTC 기준으로 날짜 문자열 생성 (타임존 변환 X)
        const sStr = `${start.getUTCFullYear()}-${String(start.getUTCMonth()+1).padStart(2,'0')}-${String(start.getUTCDate()).padStart(2,'0')}`;
        const eStr = `${end.getUTCFullYear()}-${String(end.getUTCMonth()+1).padStart(2,'0')}-${String(end.getUTCDate()).padStart(2,'0')}`;

        if (dateStr < sStr || dateStr > eStr) return false;
        if (dept && l.department !== dept) return false;
        if (nameKeyword && !(l.name || '').toLowerCase().includes(nameKeyword)) return false;
        return true;
    }).sort((a, b) => {
        // 1차: 이름 가나다순 정렬
        const nameCompare = (a.name || '').localeCompare((b.name || ''), 'ko-KR');
        if (nameCompare !== 0) return nameCompare;
        // 2차: 같은 이름일 경우 휴가 종류로 보조 정렬
        return (a.leave_type || '').localeCompare((b.leave_type || ''), 'ko-KR');
    });
}
```

> **정렬:** 셀 태그, 상세 모달 목록 모두 동일하게 이름 가나다순(localeCompare `'ko-KR'`)으로 정렬됨. 같은 이름이면 휴가 종류로 2차 정렬.

### 3-3. 달력 셀 생성 로직

```javascript
// currentYear, currentMonth: 현재 보고 있는 연월 (month는 0-based)
function getCalendarCells(currentYear, currentMonth) {
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();       // 1일의 요일 (0=일)
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate(); // 이번 달 일수
    const prevDays = new Date(currentYear, currentMonth, 0).getDate();       // 전월 일수
    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;         // 총 셀 수 (7의 배수)

    const cells = [];
    for (let i = 0; i < totalCells; i++) {
        let day, dateStr, isOther = false;

        if (i < firstDay) {
            // 이전 달
            day = prevDays - firstDay + i + 1;
            const pm = currentMonth === 0 ? 12 : currentMonth;
            const py = currentMonth === 0 ? currentYear - 1 : currentYear;
            dateStr = `${py}-${String(pm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            isOther = true;
        } else if (i >= firstDay + daysInMonth) {
            // 다음 달
            day = i - firstDay - daysInMonth + 1;
            const nm = currentMonth + 2 > 12 ? 1 : currentMonth + 2;
            const ny = currentMonth + 2 > 12 ? currentYear + 1 : currentYear;
            dateStr = `${ny}-${String(nm).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            isOther = true;
        } else {
            // 이번 달
            day = i - firstDay + 1;
            dateStr = `${currentYear}-${String(currentMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
        }

        cells.push({ day, dateStr, isOther });
    }
    return cells;
}
```

### 3-4. 월 데이터 필터 (API 응답에서 현재 월에 걸치는 것만 추출)

```javascript
function filterByMonth(leaves, year, month, statusFilter) {
    const monthStart = new Date(Date.UTC(year, month, 1));
    const monthEnd = new Date(Date.UTC(year, month + 1, 0));

    return leaves.filter(l => {
        if (statusFilter && l.status !== statusFilter) return false;
        const start = new Date(l.start_date);
        const end = new Date(l.end_date);
        return start <= monthEnd && end >= monthStart;
    });
}
```

---

## 4. HTML 구조 (React JSX 변환 시 참고)

```html
<!-- 필터 영역 -->
<div class="filter-section">
    <select id="dept-filter">
        <option value="">전체</option>
        <!-- 부서 목록 동적 생성 -->
    </select>
    <input id="name-filter" type="text" placeholder="이름 입력">
    <select id="status-filter">
        <option value="">전체</option>
        <option value="APPROVED" selected>승인</option>
        <option value="PENDING">대기</option>
        <option value="REQUESTED">요청</option>
    </select>
</div>

<!-- 캘린더 본체 -->
<div class="calendar-container">
    <!-- 네비게이션 -->
    <div class="calendar-nav">
        <button>◀ 이전</button>
        <h2>2026년 2월</h2>
        <div>
            <button>오늘</button>
            <button>다음 ▶</button>
        </div>
    </div>

    <!-- 7열 그리드 -->
    <div class="calendar-grid">
        <!-- 요일 헤더 7개 -->
        <div class="calendar-header-cell">일</div>
        <div class="calendar-header-cell">월</div>
        <!-- ... -->

        <!-- 날짜 셀 (동적 생성) -->
        <div class="calendar-cell today">
            <div class="calendar-date">19</div>
            <div class="leave-tag type-annual">김도훈 연차</div>
            <div class="leave-tag type-sick">이영희 병가</div>
            <div class="leave-more">+2건 더보기</div>
        </div>
    </div>
</div>

<!-- 범례 -->
<div>
    <span class="leave-tag type-annual">연차</span>
    <span class="leave-tag type-sick">병가</span>
    <span class="leave-tag type-special">경조사/예비군</span>
    <span class="leave-tag type-other">기타</span>
</div>

<!-- 날짜 클릭 상세 모달 -->
<div class="day-modal">
    <div class="day-modal-content">
        <h3>2026년 2월 19일 휴가자 (5명)</h3>
        <div class="day-leave-item">
            <div>
                <div>김도훈 <span>위원</span></div>
                <div>Biz AI사업부</div>
            </div>
            <div>
                <span class="leave-tag type-annual">연차</span>
                <div>승인</div>
            </div>
        </div>
    </div>
</div>
```

---

## 5. 상태 코드 매핑

```javascript
const STATUS_MAP = {
    'APPROVED':  { text: '승인', color: '#10b981' },
    'PENDING':   { text: '대기', color: '#f59e0b' },
    'REQUESTED': { text: '요청', color: '#f59e0b' },
    'REJECTED':  { text: '반려', color: '#ef4444' }
};
```

---

## 6. 셀 당 최대 태그 수 및 클릭 동작

```javascript
const MAX_TAGS = 3;  // 셀에 3개까지 표시, 나머지는 "+N건 더보기"
```

### 셀 클릭 동작

- **휴가자가 1명 이상이면** 해당 날짜 셀 전체가 클릭 가능 (`cursor: pointer`)
- 클릭 시 **인원수와 관계없이** 항상 상세 모달이 열림 (1~3명이어도 모달 표시)
- `+N건 더보기`는 4명 이상일 때만 노출되지만, 모달은 1명부터 동작

```javascript
// 셀 클릭 판단 로직
const clickableAttr = dayLeaves.length > 0
    ? ` onclick="showDayDetail('${dateStr}')" style="cursor: pointer;"`
    : '';
```

---

## 7. 정렬 규칙

모든 목록(셀 태그, 상세 모달)은 동일한 정렬 기준 적용:

| 우선순위 | 기준 | 방향 |
|----------|------|------|
| 1차 | 이름 (가나다순) | 오름차순 (`localeCompare('ko-KR')`) |
| 2차 | 휴가 종류 (가나다순) | 오름차순 |

---

## 8. 주의사항

1. **날짜는 반드시 UTC 기준으로 파싱** — `getUTCFullYear()`, `getUTCMonth()`, `getUTCDate()` 사용. `getFullYear()` 등 로컬 메서드 사용 시 한국시간(+9)으로 날짜가 밀림.
2. **page_size=500** — 한 번에 충분한 데이터를 가져옴. 사원 수가 많으면 조정 필요.
3. **필터는 클라이언트 사이드** — 부서/이름 필터는 이미 받아온 데이터를 JS에서 필터링. 상태 필터만 재조회.
4. **정렬은 항상 가나다순** — 셀 태그, 상세 모달 목록 모두 `localeCompare('ko-KR')`로 이름 가나다순 정렬. 정렬 로직은 `getLeavesForDate()` 내부에 포함되어 있으므로 별도 처리 불필요.
