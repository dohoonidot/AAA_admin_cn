/**
 * 커스텀 셀렉트 드롭다운 (WebView2 네이티브 <select> 대체)
 *
 * 모든 <select> 요소를 자동으로 DOM 기반 커스텀 드롭다운으로 변환합니다.
 * 기존 JS 코드와 100% 호환: .value, .selectedIndex, .options, change 이벤트 등
 *
 * 사용법: 이 스크립트를 페이지에 포함하면 자동 초기화됩니다.
 *   <script src="../js/utils/custom-select.js"></script>
 */
(function () {
    'use strict';

    // 검색 입력 표시 기준 (옵션 수가 이 값 이상이면 검색 표시)
    var SEARCH_THRESHOLD = 8;

    // 이미 초기화된 셀렉트 확인용
    var INIT_FLAG = '_csInstance';

    /**
     * CustomSelect 클래스
     */
    function CustomSelect(selectEl) {
        if (selectEl[INIT_FLAG]) return selectEl[INIT_FLAG];

        this.select = selectEl;
        this.select[INIT_FLAG] = this;
        this.isOpen = false;
        this.focusedIdx = -1;
        this.wrapper = null;
        this.trigger = null;
        this.textSpan = null;
        this.dropdown = null;
        this.searchInput = null;
        this.optionEls = [];

        this._build();
        this._bindEvents();
        this._observeChanges();
        this._overrideProps();
    }

    /* =====================
       DOM 구성
       ===================== */
    CustomSelect.prototype._build = function () {
        var sel = this.select;
        var parent = sel.parentNode;

        // 1) 변환 전 스타일 캡처 (보이는 상태에서)
        var computed = window.getComputedStyle(sel);
        var capturedWidth = sel.offsetWidth;
        var capturedMinW = computed.minWidth;
        var capturedMaxW = computed.maxWidth;
        var capturedMarginBottom = computed.marginBottom;
        var capturedHeight = computed.height;

        // 2) 래퍼 생성
        this.wrapper = document.createElement('div');
        this.wrapper.className = 'custom-select-wrapper';

        // toolbar-select 클래스 확인
        if (sel.classList.contains('toolbar-select')) {
            this.wrapper.classList.add('toolbar-select-wrapper');
        }

        // ID 기록
        if (sel.id) {
            this.wrapper.setAttribute('data-select-id', sel.id);
        }

        // 크기 적용
        if (capturedWidth > 0) {
            this.wrapper.style.width = capturedWidth + 'px';
        } else {
            this.wrapper.style.width = '100%';
        }
        if (capturedMinW && capturedMinW !== '0px') {
            this.wrapper.style.minWidth = capturedMinW;
        }
        if (capturedMaxW && capturedMaxW !== 'none') {
            this.wrapper.style.maxWidth = capturedMaxW;
        }
        // margin-bottom 유지 (레이아웃 보존)
        if (capturedMarginBottom && capturedMarginBottom !== '0px') {
            this.wrapper.style.marginBottom = capturedMarginBottom;
        }

        // 3) 래퍼를 select 자리에 삽입
        parent.insertBefore(this.wrapper, sel);

        // 4) 네이티브 select 숨기고 래퍼 안으로 이동
        sel.style.cssText = 'position:absolute!important;width:1px!important;height:1px!important;opacity:0!important;pointer-events:none!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;border:0!important;margin:0!important;padding:0!important;';
        this.wrapper.appendChild(sel);

        // 5) 트리거 생성
        this.trigger = document.createElement('div');
        this.trigger.className = 'custom-select-trigger';
        this.trigger.setAttribute('tabindex', '0');
        this.trigger.setAttribute('role', 'combobox');
        this.trigger.setAttribute('aria-haspopup', 'listbox');
        this.trigger.setAttribute('aria-expanded', 'false');

        this.textSpan = document.createElement('span');
        this.textSpan.className = 'custom-select-text';
        this.trigger.appendChild(this.textSpan);

        this.wrapper.appendChild(this.trigger);

        // 6) 드롭다운 생성
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'custom-select-dropdown';
        this.dropdown.setAttribute('role', 'listbox');
        this.wrapper.appendChild(this.dropdown);

        // 7) 옵션 빌드
        this._rebuildOptions();
        this._updateTrigger();
        this._updateDisabled();
    };

    /* =====================
       옵션 목록 재구성
       ===================== */
    CustomSelect.prototype._rebuildOptions = function () {
        var self = this;
        var dd = this.dropdown;
        dd.innerHTML = '';
        this.optionEls = [];

        var opts = this.select.options;

        // 검색 기능 (옵션 많을 때)
        if (opts.length >= SEARCH_THRESHOLD) {
            var searchWrap = document.createElement('div');
            searchWrap.className = 'custom-select-search';
            var searchInput = document.createElement('input');
            searchInput.type = 'text';
            searchInput.placeholder = '검색...';
            searchInput.setAttribute('autocomplete', 'off');
            searchWrap.appendChild(searchInput);
            dd.appendChild(searchWrap);
            this.searchInput = searchInput;

            searchInput.addEventListener('input', function () {
                self._filterOptions(this.value);
            });
            // 검색 입력 중 드롭다운 닫힘 방지
            searchInput.addEventListener('click', function (e) {
                e.stopPropagation();
            });
            searchInput.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    self.close();
                    self.trigger.focus();
                } else if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    self._focusOption(0);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    // 포커스된 옵션 선택
                    if (self.focusedIdx >= 0 && self.optionEls[self.focusedIdx]) {
                        self._selectByDomIndex(self.focusedIdx);
                        self.close();
                        self.trigger.focus();
                    }
                }
            });
        } else {
            this.searchInput = null;
        }

        // 옵션 생성
        for (var i = 0; i < opts.length; i++) {
            var opt = opts[i];
            var div = document.createElement('div');
            div.className = 'custom-select-option';
            div.setAttribute('data-value', opt.value);
            div.setAttribute('data-index', i);
            div.setAttribute('role', 'option');
            div.textContent = opt.textContent;

            if (i === this.select.selectedIndex) {
                div.classList.add('selected');
            }
            if (opt.disabled) {
                div.classList.add('disabled');
            }

            (function (idx, divEl) {
                divEl.addEventListener('click', function (e) {
                    e.stopPropagation();
                    if (divEl.classList.contains('disabled')) return;
                    self._selectByNativeIndex(idx);
                    self.close();
                    self.trigger.focus();
                });
            })(i, div);

            dd.appendChild(div);
            this.optionEls.push(div);
        }
    };

    /* =====================
       검색 필터링
       ===================== */
    CustomSelect.prototype._filterOptions = function (query) {
        var q = query.toLowerCase().trim();
        var hasVisible = false;

        for (var i = 0; i < this.optionEls.length; i++) {
            var el = this.optionEls[i];
            var text = el.textContent.toLowerCase();
            if (!q || text.indexOf(q) !== -1) {
                el.style.display = '';
                hasVisible = true;
            } else {
                el.style.display = 'none';
            }
        }

        // "결과 없음" 메시지
        var noResults = this.dropdown.querySelector('.custom-select-no-results');
        if (!hasVisible) {
            if (!noResults) {
                noResults = document.createElement('div');
                noResults.className = 'custom-select-no-results';
                noResults.textContent = '검색 결과가 없습니다';
                this.dropdown.appendChild(noResults);
            }
            noResults.style.display = '';
        } else if (noResults) {
            noResults.style.display = 'none';
        }

        this.focusedIdx = -1;
    };

    /* =====================
       트리거 텍스트 업데이트
       ===================== */
    CustomSelect.prototype._updateTrigger = function () {
        var opt = this.select.options[this.select.selectedIndex];
        if (opt) {
            this.textSpan.textContent = opt.textContent;
            this.trigger.setAttribute('data-value', opt.value);
        } else {
            this.textSpan.textContent = '';
            this.trigger.setAttribute('data-value', '');
        }
    };

    /* =====================
       선택 클래스 업데이트
       ===================== */
    CustomSelect.prototype._updateSelected = function () {
        var idx = this.select.selectedIndex;
        for (var i = 0; i < this.optionEls.length; i++) {
            var el = this.optionEls[i];
            if (parseInt(el.getAttribute('data-index'), 10) === idx) {
                el.classList.add('selected');
            } else {
                el.classList.remove('selected');
            }
        }
    };

    /* =====================
       옵션 선택 (네이티브 인덱스 기준)
       ===================== */
    CustomSelect.prototype._selectByNativeIndex = function (nativeIndex) {
        // 네이티브 프로토타입 setter 사용
        var desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
        if (desc && desc.set) {
            desc.set.call(this.select, nativeIndex);
        } else {
            this.select.selectedIndex = nativeIndex;
        }

        this._updateTrigger();
        this._updateSelected();

        // change 이벤트 발생
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
    };

    /* =====================
       옵션 선택 (DOM 옵션 인덱스 기준)
       ===================== */
    CustomSelect.prototype._selectByDomIndex = function (domIdx) {
        var el = this.optionEls[domIdx];
        if (!el || el.classList.contains('disabled')) return;
        var nativeIdx = parseInt(el.getAttribute('data-index'), 10);
        this._selectByNativeIndex(nativeIdx);
    };

    /* =====================
       비활성화 상태 동기화
       ===================== */
    CustomSelect.prototype._updateDisabled = function () {
        if (this.select.disabled) {
            this.wrapper.classList.add('disabled');
            this.trigger.removeAttribute('tabindex');
        } else {
            this.wrapper.classList.remove('disabled');
            this.trigger.setAttribute('tabindex', '0');
        }
    };

    /* =====================
       열기 / 닫기
       ===================== */
    CustomSelect.prototype.open = function () {
        if (this.select.disabled) return;
        if (this.isOpen) return;

        // 다른 열린 드롭다운 닫기
        var allOpen = document.querySelectorAll('.custom-select-wrapper.open');
        for (var i = 0; i < allOpen.length; i++) {
            var inst = allOpen[i].querySelector('select');
            if (inst && inst[INIT_FLAG] && inst[INIT_FLAG] !== this) {
                inst[INIT_FLAG].close();
            }
        }

        this.isOpen = true;
        this.wrapper.classList.add('open');
        this.dropdown.classList.add('open');
        this.trigger.setAttribute('aria-expanded', 'true');
        this.focusedIdx = -1;

        // 검색 초기화
        if (this.searchInput) {
            this.searchInput.value = '';
            this._filterOptions('');
            // 검색에 포커스
            var si = this.searchInput;
            setTimeout(function () { si.focus(); }, 10);
        }

        // 선택된 옵션 스크롤
        var selectedEl = this.dropdown.querySelector('.custom-select-option.selected');
        if (selectedEl) {
            selectedEl.scrollIntoView({ block: 'nearest' });
        }

        // 위/아래 방향 결정
        this._positionDropdown();
    };

    CustomSelect.prototype.close = function () {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.wrapper.classList.remove('open');
        this.dropdown.classList.remove('open');
        this.dropdown.classList.remove('open-up');
        this.trigger.setAttribute('aria-expanded', 'false');
        this.focusedIdx = -1;

        // 포커스 클래스 제거
        for (var i = 0; i < this.optionEls.length; i++) {
            this.optionEls[i].classList.remove('focused');
        }
    };

    CustomSelect.prototype.toggle = function () {
        if (this.isOpen) {
            this.close();
        } else {
            this.open();
        }
    };

    /* =====================
       드롭다운 위치 (위/아래)
       ===================== */
    CustomSelect.prototype._positionDropdown = function () {
        var triggerRect = this.trigger.getBoundingClientRect();
        var spaceBelow = window.innerHeight - triggerRect.bottom;
        var dropdownHeight = Math.min(240, this.dropdown.scrollHeight);

        if (spaceBelow < dropdownHeight && triggerRect.top > spaceBelow) {
            // 위쪽으로 열기
            this.dropdown.style.top = 'auto';
            this.dropdown.style.bottom = '100%';
            this.dropdown.style.marginTop = '0';
            this.dropdown.style.marginBottom = '4px';
            this.dropdown.classList.add('open-up');
        } else {
            // 아래쪽으로 열기 (기본)
            this.dropdown.style.top = '100%';
            this.dropdown.style.bottom = 'auto';
            this.dropdown.style.marginTop = '4px';
            this.dropdown.style.marginBottom = '0';
            this.dropdown.classList.remove('open-up');
        }
    };

    /* =====================
       키보드 옵션 포커스
       ===================== */
    CustomSelect.prototype._focusOption = function (idx) {
        // 보이는 옵션만 대상
        var visible = [];
        for (var i = 0; i < this.optionEls.length; i++) {
            if (this.optionEls[i].style.display !== 'none' && !this.optionEls[i].classList.contains('disabled')) {
                visible.push(i);
            }
        }
        if (visible.length === 0) return;

        // 범위 제한
        if (idx < 0) idx = 0;
        if (idx >= visible.length) idx = visible.length - 1;

        // 이전 포커스 제거
        for (var j = 0; j < this.optionEls.length; j++) {
            this.optionEls[j].classList.remove('focused');
        }

        this.focusedIdx = visible[idx];
        this.optionEls[this.focusedIdx].classList.add('focused');
        this.optionEls[this.focusedIdx].scrollIntoView({ block: 'nearest' });
    };

    CustomSelect.prototype._navigateOptions = function (direction) {
        var visible = [];
        for (var i = 0; i < this.optionEls.length; i++) {
            if (this.optionEls[i].style.display !== 'none' && !this.optionEls[i].classList.contains('disabled')) {
                visible.push(i);
            }
        }
        if (visible.length === 0) return;

        var currentVisibleIdx = -1;
        for (var k = 0; k < visible.length; k++) {
            if (visible[k] === this.focusedIdx) {
                currentVisibleIdx = k;
                break;
            }
        }

        var newVisibleIdx = currentVisibleIdx + direction;
        if (newVisibleIdx < 0) newVisibleIdx = 0;
        if (newVisibleIdx >= visible.length) newVisibleIdx = visible.length - 1;

        this._focusOption(newVisibleIdx);
    };

    /* =====================
       이벤트 바인딩
       ===================== */
    CustomSelect.prototype._bindEvents = function () {
        var self = this;

        // 트리거 클릭
        this.trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            self.toggle();
        });

        // 트리거 키보드
        this.trigger.addEventListener('keydown', function (e) {
            switch (e.key) {
                case 'Enter':
                case ' ':
                    e.preventDefault();
                    e.stopPropagation();
                    if (self.isOpen && self.focusedIdx >= 0) {
                        self._selectByDomIndex(self.focusedIdx);
                        self.close();
                    } else {
                        self.toggle();
                    }
                    break;
                case 'Escape':
                    e.preventDefault();
                    self.close();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    if (!self.isOpen) {
                        self.open();
                    } else {
                        self._navigateOptions(1);
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    if (self.isOpen) {
                        self._navigateOptions(-1);
                    }
                    break;
                case 'Tab':
                    self.close();
                    break;
            }
        });

        // 네이티브 select의 focus 이벤트를 트리거로 전달
        this.select.addEventListener('focus', function () {
            self.trigger.focus();
        });
    };

    /* =====================
       MutationObserver (동적 옵션 변경 감지)
       ===================== */
    CustomSelect.prototype._observeChanges = function () {
        var self = this;
        var rebuildTimer = null;

        this._observer = new MutationObserver(function (mutations) {
            var needsRebuild = false;
            var needsDisabledUpdate = false;
            var needsVisibilityUpdate = false;

            for (var i = 0; i < mutations.length; i++) {
                var m = mutations[i];

                if (m.type === 'childList') {
                    needsRebuild = true;
                }
                if (m.type === 'attributes') {
                    if (m.attributeName === 'disabled') {
                        needsDisabledUpdate = true;
                    }
                    if (m.attributeName === 'class') {
                        needsVisibilityUpdate = true;
                    }
                }
            }

            // classList.add('hidden') 등에 의한 표시/숨김 동기화
            if (needsVisibilityUpdate) {
                if (self.select.classList.contains('hidden')) {
                    self.wrapper.style.display = 'none';
                } else {
                    self.wrapper.style.display = '';
                }
            }

            if (needsDisabledUpdate) {
                self._updateDisabled();
            }

            if (needsRebuild) {
                // 빠른 연속 변경 시 디바운스
                clearTimeout(rebuildTimer);
                rebuildTimer = setTimeout(function () {
                    self._rebuildOptions();
                    self._updateTrigger();
                    self._updateSelected();
                }, 10);
            }
        });

        this._observer.observe(this.select, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled', 'class']
        });
    };

    /* =====================
       프로퍼티 오버라이드 (.value, .selectedIndex, .disabled 동기화)
       ===================== */
    CustomSelect.prototype._overrideProps = function () {
        var self = this;
        var sel = this.select;

        // .value 오버라이드
        var valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
        if (valueDesc) {
            Object.defineProperty(sel, 'value', {
                get: function () {
                    return valueDesc.get.call(sel);
                },
                set: function (val) {
                    valueDesc.set.call(sel, val);
                    self._updateTrigger();
                    self._updateSelected();
                },
                configurable: true,
                enumerable: true
            });
        }

        // .selectedIndex 오버라이드
        var idxDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
        if (idxDesc) {
            Object.defineProperty(sel, 'selectedIndex', {
                get: function () {
                    return idxDesc.get.call(sel);
                },
                set: function (val) {
                    idxDesc.set.call(sel, val);
                    self._updateTrigger();
                    self._updateSelected();
                },
                configurable: true,
                enumerable: true
            });
        }

        // .disabled 오버라이드
        var disDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'disabled');
        if (disDesc) {
            Object.defineProperty(sel, 'disabled', {
                get: function () {
                    return disDesc.get.call(sel);
                },
                set: function (val) {
                    disDesc.set.call(sel, val);
                    self._updateDisabled();
                },
                configurable: true,
                enumerable: true
            });
        }

        // .innerHTML 오버라이드 (옵션 동적 교체 감지)
        var innerDesc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
        if (innerDesc) {
            Object.defineProperty(sel, 'innerHTML', {
                get: function () {
                    return innerDesc.get.call(sel);
                },
                set: function (val) {
                    innerDesc.set.call(sel, val);
                    // MutationObserver가 처리하지만, 즉시 반영도 보장
                    setTimeout(function () {
                        self._rebuildOptions();
                        self._updateTrigger();
                    }, 0);
                },
                configurable: true,
                enumerable: true
            });
        }
    };

    /* =====================
       파괴 (필요 시)
       ===================== */
    CustomSelect.prototype.destroy = function () {
        if (this._observer) {
            this._observer.disconnect();
        }

        // 프로퍼티 오버라이드 복원
        delete this.select.value;
        delete this.select.selectedIndex;
        delete this.select.disabled;
        delete this.select.innerHTML;

        // select를 래퍼 바깥으로 이동
        this.select.style.cssText = '';
        this.wrapper.parentNode.insertBefore(this.select, this.wrapper);
        this.wrapper.remove();

        delete this.select[INIT_FLAG];
    };


    /* ============================================================
       전역: 외부 클릭 시 닫기
       ============================================================ */
    document.addEventListener('click', function () {
        var allOpen = document.querySelectorAll('.custom-select-wrapper.open');
        for (var i = 0; i < allOpen.length; i++) {
            var selectEl = allOpen[i].querySelector('select');
            if (selectEl && selectEl[INIT_FLAG]) {
                selectEl[INIT_FLAG].close();
            }
        }
    });

    // 스크롤 시 열린 드롭다운 위치 재계산
    var scrollTimer = null;
    window.addEventListener('scroll', function () {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(function () {
            var allOpen = document.querySelectorAll('.custom-select-wrapper.open');
            for (var i = 0; i < allOpen.length; i++) {
                var selectEl = allOpen[i].querySelector('select');
                if (selectEl && selectEl[INIT_FLAG]) {
                    selectEl[INIT_FLAG]._positionDropdown();
                }
            }
        }, 50);
    }, true);


    /* ============================================================
       초기화 함수
       ============================================================ */
    function initCustomSelects(container) {
        container = container || document;
        var selects = container.querySelectorAll('select:not([data-native])');
        for (var i = 0; i < selects.length; i++) {
            if (!selects[i][INIT_FLAG]) {
                try {
                    new CustomSelect(selects[i]);
                } catch (err) {
                    console.warn('[CustomSelect] 초기화 실패:', selects[i].id || selects[i].name, err);
                }
            }
        }
    }

    /* ============================================================
       동적으로 추가되는 select 감지 (MutationObserver)
       ============================================================ */
    var bodyObserver = null;

    function startBodyObserver() {
        if (bodyObserver) return;

        bodyObserver = new MutationObserver(function (mutations) {
            var hasNew = false;
            for (var i = 0; i < mutations.length; i++) {
                var addedNodes = mutations[i].addedNodes;
                for (var j = 0; j < addedNodes.length; j++) {
                    var node = addedNodes[j];
                    if (node.nodeType !== 1) continue;

                    if (node.tagName === 'SELECT' && !node[INIT_FLAG] && !node.hasAttribute('data-native')) {
                        hasNew = true;
                        break;
                    }
                    if (node.querySelector && node.querySelector('select:not([data-native])')) {
                        hasNew = true;
                        break;
                    }
                }
                if (hasNew) break;
            }

            if (hasNew) {
                // 약간 지연 후 초기화 (DOM 완성 대기)
                setTimeout(function () {
                    initCustomSelects(document.body);
                }, 50);
            }
        });

        bodyObserver.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    /* ============================================================
       자동 실행
       ============================================================ */
    function bootstrap() {
        initCustomSelects();
        startBodyObserver();
        console.log('[CustomSelect] 초기화 완료 -', document.querySelectorAll('.custom-select-wrapper').length, '개 셀렉트 변환됨');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        // DOMContentLoaded 이미 지남 → 즉시 실행
        bootstrap();
    }

    /* ============================================================
       외부 API
       ============================================================ */
    window.CustomSelectUtil = {
        init: initCustomSelects,
        getInstance: function (selectEl) {
            return selectEl ? selectEl[INIT_FLAG] : null;
        },
        destroyAll: function (container) {
            container = container || document;
            var wrappers = container.querySelectorAll('.custom-select-wrapper');
            for (var i = 0; i < wrappers.length; i++) {
                var sel = wrappers[i].querySelector('select');
                if (sel && sel[INIT_FLAG]) {
                    sel[INIT_FLAG].destroy();
                }
            }
        },
        refresh: function (selectEl) {
            // 특정 select의 옵션을 다시 빌드
            if (selectEl && selectEl[INIT_FLAG]) {
                selectEl[INIT_FLAG]._rebuildOptions();
                selectEl[INIT_FLAG]._updateTrigger();
                selectEl[INIT_FLAG]._updateSelected();
            }
        }
    };

})();
