if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js')
      .then(() => console.log('Кремниевый оффлайн-модуль активирован.'))
      .catch((err) => console.error('Ошибка активации:', err));
  });
}
document.addEventListener("DOMContentLoaded", () => {
    // DOM-узлы таблицы и виджета скролла
    const tableBody = document.querySelector("#finance-table tbody");
    const navWidget = document.querySelector("#nav-widget");
    const navSlider = document.querySelector("#nav-slider");
    const navTrack = document.querySelector("#nav-track");
    
    // Модальные окна и панель управления
    const commentModal = document.getElementById("comment-modal");
    const viewModal = document.getElementById("view-modal");
    const searchModal = document.getElementById("search-modal");
    const bottomPanel = document.getElementById("bottom-panel");
    const importFileInput = document.getElementById("import-file-input");
    
    // Поля ввода и кнопки внутри модалок
    const modalShortInput = document.getElementById("modal-short-input");
    const modalFullInput = document.getElementById("modal-full-input");
    const viewFullText = document.getElementById("view-full-text");
    const modalSearchInput = document.getElementById("modal-search-input");
    
    const modalCancel = document.getElementById("modal-cancel");
    const modalOk = document.getElementById("modal-ok");
    const viewClose = document.getElementById("view-close");
    
    const searchModalReset = document.getElementById("search-modal-reset");
    const searchModalCancel = document.getElementById("search-modal-cancel");
    const searchModalOk = document.getElementById("search-modal-ok");
    
    let activeCommentInput = null;
    let isDragging = false;
    let startY, startTop;
    let currentSearchQuery = ""; // Хранилище активного фильтра
    let scrollTimeout = null; // Для исчезающего скролла

    // Извлекает чистое число, полностью уничтожая любые пробелы и нормализуя запятые
    function parseNumber(text) {
        if (!text) return 0;
        // Удаляем абсолютно все виды пробелов и пробельных символов
        let clean = text.replace(/\s/g, '').replace(/\u00A0/g, '');
        // Меняем русскую запятую на системную точку JS
        clean = clean.replace(',', '.');
        const num = parseFloat(clean);
        return isNaN(num) ? 0 : num;
    }

    // Превращает число в HTML-строку с визуальными фантомными пробелами и запятой
    function formatToPhantomHTML(value) {
        const num = parseNumber(String(value));
        if (num === 0) return "0,00";
        
        const isNegative = num < 0;
        const absNum = Math.abs(num);
        const parts = absNum.toFixed(2).split('.');
        const integerPart = parts[0];
        const decimalPart = parts[1];

        let html = "";
        let len = integerPart.length;
        
        for (let i = 0; i < len; i++) {
            const distanceFromEnd = len - 1 - i;
            if (distanceFromEnd > 0 && distanceFromEnd % 3 === 0) {
                html += `<span class="phantom-thousands-1">${integerPart[i]}</span>`;
            } else {
                html += integerPart[i];
            }
        }
        
        return (isNegative ? "-" : "") + html + "," + decimalPart;
    }

    // Оптимизированный каскадный пересчет остатков строго ОТ измененной строки и НИЖЕ
    function recalculateBalancesFrom(startRowIndex = 0) {
        const rows = tableBody.querySelectorAll("tr");
        let currentBalance = 0;

        // Если пересчет идет не с начала, берем накопленный баланс предыдущей строки
        if (startRowIndex > 0 && rows[startRowIndex - 1]) {
            const prevBalanceCell = rows[startRowIndex - 1].querySelector(".cell-balance");
            currentBalance = parseNumber(prevBalanceCell.textContent);
        }
        
        rows.forEach((row, index) => {
            // Индексы строк пересчитываем всегда для соблюдения порядка 0001, 0002...
            const newIndex = index + 1;
            row.setAttribute("data-row", newIndex);
            row.querySelector(".row-number").textContent = String(newIndex).padStart(4, '0');

            // Математику считаем только начиная с целевого индекса, экономя ресурсы
            if (index >= startRowIndex) {
                const incomeInput = row.querySelector(".cell-income");
                const expenseInput = row.querySelector(".cell-expense");

                const incomeStr = incomeInput.value.trim();
                const expenseStr = expenseInput.value.trim();

                const income = parseNumber(incomeStr);
                const expense = parseNumber(expenseStr);
                
                // Защита мьютекса при пересчете
                if (income > 0) { 
                    expenseInput.disabled = true; 
                } else if (expense > 0) { 
                    incomeInput.disabled = true; 
                } else { 
                    incomeInput.disabled = false; 
                    expenseInput.disabled = false; 
                }

                const isEmptyRow = (income === 0 && expense === 0) && (incomeStr === "");
                currentBalance += (income - expense);
                
                const balanceCell = row.querySelector(".cell-balance");
                balanceCell.innerHTML = isEmptyRow ? "" : formatToPhantomHTML(currentBalance);
            }
        });

        updateWidgetVisibility();
        updateSliderPosition();
        saveDataToStorage(); // Автосохранение
    }

    // Системный генератор даты: ищет последнюю заполненную дату вверх по таблице
    function getFallbackDateString(currentRow = null) {
        if (currentRow) {
            let scanRow = currentRow.previousElementSibling;
            // Бежим вверх по DOM-дереву, пока не найдем строку с непустой датой
            while (scanRow) {
                const val = scanRow.querySelector(".cell-date").value.trim();
                if (val !== "") {
                    return val; // Нашли дату в истории — возвращаем её
                }
                scanRow = scanRow.previousElementSibling;
            }
        }
        
        // Если вся таблица выше пустая, генерируем сегодняшнюю дату
        const today = new Date();
        const dd = String(today.getDate()).padStart(2, '0');
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const yyyy = today.getFullYear();
        return `${dd}.${mm}.${yyyy}`;
    }

    // Календарный валидатор
    function isValidDateFull(str) {
        if (!/^\d{2}\.\d{2}\.\d{4}$/.test(str)) return false;
        const [day, month, year] = str.split('.').map(Number);
        if (month < 1 || month > 12 || day < 1 || year < 1900 || year > 2100) return false;
        
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || (year % 400 === 0);
        const daysInMonth = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        
        return day <= daysInMonth[month - 1];
    }
    // Создает новую строку, наследуя дату из предыдущей (если она есть)
    function createNewRow(afterRow = null) {
        const rows = tableBody.querySelectorAll("tr");
        if (rows.length >= 9999) {
            alert("⚠️ Лимит строк превышен (9999).");
            return null;
        }

        const newTr = document.createElement("tr");
        // Новая строка создается абсолютно пустой (стерильной), без даты по умолчанию
        newTr.innerHTML = `
            <td class="row-number">0000</td>
            <td><input type="text" inputmode="numeric" class="cell-date" value="" placeholder="ДД.ММ.ГГГГ" maxlength="10"></td>
            <td><input type="text" inputmode="decimal" class="cell-income" placeholder="0,00"></td>
            <td><input type="text" inputmode="decimal" class="cell-expense" placeholder="0,00"></td>
            <td class="cell-balance"></td>
            <td><input type="text" class="cell-comment" placeholder="" readonly data-full-comment="" tabindex="-1" disabled></td>
        `;
        
        if (afterRow) {
            afterRow.parentNode.insertBefore(newTr, afterRow.nextSibling);
        } else {
            tableBody.appendChild(newTr);
        }
        
        initRowEvents(newTr);
        
        const currentIndex = Array.from(tableBody.querySelectorAll("tr")).indexOf(newTr);
        if (currentSearchQuery !== "") {
            applySearchFilter();
        } else {
            recalculateBalancesFrom(currentIndex);
        }
        
        // Переводим фокус на дату новой строки
        const newDateInput = newTr.querySelector(".cell-date");
        newDateInput.focus();
        return newTr;
    }

    // Навешивает логику и маски на поля конкретной строки
    function initRowEvents(row) {
        const dateInput = row.querySelector(".cell-date");
        const incomeInput = row.querySelector(".cell-income");
        const expenseInput = row.querySelector(".cell-expense");
        const commentInput = row.querySelector(".cell-comment");
        const numCell = row.querySelector(".row-number");

        // Умная маска даты: сохраняет позицию курсора при редактировании любой цифры
        let oldDateValue = dateInput.value;
        dateInput.addEventListener("input", (e) => {
            let cursorPosition = dateInput.selectionStart;
            const originalLength = dateInput.value.length;
            
            let digits = dateInput.value.replace(/\D/g, "");
            let formatted = "";
            
            if (digits.length > 0) {
                formatted += digits.slice(0, 2);
                if (digits.length > 2) {
                    formatted += "." + digits.slice(2, 4);
                    if (digits.length > 4) {
                        formatted += "." + digits.slice(4, 8);
                    }
                }
            }
            
            dateInput.value = formatted;
            
            // Корректируем положение курсора, чтобы он не улетал в конец строки
            if (cursorPosition !== null) {
                const delta = formatted.length - originalLength;
                let newPosition = cursorPosition + delta;
                
                // Предотвращаем залипание перед точками
                if ((newPosition === 2 || newPosition === 5) && e.inputType !== "deleteContentBackward") {
                    newPosition++;
                }
                dateInput.setSelectionRange(newPosition, newPosition);
            }
            oldDateValue = formatted;
        });

        // Календарный blur-валидатор: если дата некорректна, откатывает её
        dateInput.addEventListener("blur", () => {
            const val = dateInput.value.trim();
            // Если строка пустая и финансовые поля чисты, дату не трогаем
            if (val === "" && parseNumber(incomeInput.value) === 0 && parseNumber(expenseInput.value) === 0) {
                return;
            }
            if (!isValidDateFull(val)) {
                dateInput.value = getFallbackDateString(row);
            }
            saveDataToStorage();
        });
        // Интерактивное форматирование финансовых полей (запятые для копеек)
        [incomeInput, expenseInput].forEach(input => {
            input.addEventListener("focus", () => {
                const pureNum = parseNumber(input.value);
                // При фокусе выдаем чистую строку без пробелов с запятой для удобного редактирования
                input.value = pureNum > 0 ? pureNum.toFixed(2).replace('.', ',') : "";
            });

            input.addEventListener("blur", () => {
                const val = parseNumber(input.value);
                if (val > 0) {
                    // Строго фиксируем 2 знака после запятой
                    const fixedStr = val.toFixed(2);
                    const [intPart, decPart] = fixedStr.split('.');
                    // Расставляем пробелы тысяч только в целой части числа
                    const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
                    input.value = formattedInt + "," + decPart;
                    
                    // Разблокируем примечание, если появились деньги
                    commentInput.disabled = false;
                } else {
                    input.value = "";
                }

                // Синхронная проверка: если оба финансовых поля очистились — прячем дату и блокируем комменты
                if (parseNumber(incomeInput.value) === 0 && parseNumber(expenseInput.value) === 0) {
                    dateInput.value = "";
                    commentInput.value = "";
                    commentInput.setAttribute("data-full-comment", "");
                    commentInput.disabled = true;
                }

                const currentIndex = Array.from(tableBody.querySelectorAll("tr")).indexOf(row);
                recalculateBalancesFrom(currentIndex);
            });
        });

        // Мьютекс финансовых полей + принудительный инжект даты при начале ввода цифр
        row.addEventListener("input", (e) => {
            const isIncome = e.target.classList.contains("cell-income");
            const isExpense = e.target.classList.contains("cell-expense");

            // НАШ ФИКС: Если юзер начал вводить деньги, а дата пустая — мгновенно берем дату из истории
            if ((isIncome || isExpense) && dateInput.value.trim() === "") {
                dateInput.value = getFallbackDateString(row);
            }

            if (isIncome) {
                const val = parseNumber(incomeInput.value);
                if (val > 0) { expenseInput.value = ""; expenseInput.disabled = true; commentInput.disabled = false; } 
                else { expenseInput.disabled = false; }
            }
            // ... остальной код события input без изменений

            // Живой контроль примечания во время стирания цифр юзером
            if (parseNumber(incomeInput.value) === 0 && parseNumber(expenseInput.value) === 0) {
                commentInput.disabled = true;
            }
        });

        // Навигация по Enter
        row.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                if (e.target.classList.contains("cell-date")) {
                    if (!incomeInput.disabled) incomeInput.focus();
                    else expenseInput.focus();
                } else if (e.target.classList.contains("cell-income") || e.target.classList.contains("cell-expense")) {
                    e.target.blur();
                    const currentRowNum = parseInt(row.getAttribute("data-row"));
                    const totalRows = tableBody.querySelectorAll("tr").length;
                    if (currentRowNum === totalRows) {
                        createNewRow();
                    }
                }
            }
        });

        // --- Кроссплатформенная логика кликов по примечанию ---
        let commentTimer;
        let preventClick = false;

        commentInput.addEventListener("touchstart", (e) => {
            if (commentInput.disabled) return;
            preventClick = false;
            commentTimer = setTimeout(() => {
                preventClick = true;
                openEditModal(commentInput);
            }, 600);
        }, { passive: true });

        commentInput.addEventListener("touchend", () => {
            clearTimeout(commentTimer);
        });

        commentInput.addEventListener("click", (e) => {
            if (commentInput.disabled) return;
            if (preventClick) { e.preventDefault(); return; }
            
            if (e.pointerType === 'touch' || window.matchMedia("(pointer: coarse)").matches) {
                if (commentInput.value.trim() === "") openEditModal(commentInput);
                else openViewModal(commentInput);
                return;
            }

            if (e.detail === 1) {
                setTimeout(() => {
                    if (!commentModal.classList.contains("active")) {
                        if (commentInput.value.trim() === "") openEditModal(commentInput);
                        else openViewModal(commentInput);
                    }
                }, 200);
            }
        });

        row.addEventListener("dblclick", (e) => {
            if (e.target.classList.contains("cell-comment") && !commentInput.disabled) {
                openEditModal(commentInput);
            }
        });

        commentInput.addEventListener("contextmenu", (e) => {
            if (commentInput.disabled) return;
            e.preventDefault();
            openEditModal(commentInput);
        });

        // --- Управление строками через индекс таблицы (.row-number) ---
        let rowPressTimer;
        let isRowLongPress = false;

        // Длинный тап на индекс (600мс) — удаление строки на Android
        numCell.addEventListener("touchstart", (e) => {
            isRowLongPress = false;
            rowPressTimer = setTimeout(() => {
                isRowLongPress = true;
                // Блокируем вызов contextmenu и эмуляцию кликов после тача
                e.preventDefault(); 
                executeRowDeletion(row, numCell.textContent);
            }, 600);
        }, { passive: false }); // Изменено на false, чтобы работал preventDefault

        numCell.addEventListener("touchend", () => {
            clearTimeout(rowPressTimer);
            // Флаг сбрасываем чуть позже, чтобы одиночный click не сработал ложно
            setTimeout(() => { isRowLongPress = false; }, 100);
        });

        // Одиночный клик по индексу — создание новой строки ниже
        numCell.addEventListener("click", (e) => {
            if (isRowLongPress) {
                e.preventDefault();
                return;
            }
            createNewRow(row);
        });

        // Правый клик мыши по индексу — удаление строки на Windows
        numCell.addEventListener("contextmenu", (e) => {
            // Если это был длинный тап на планшете, contextmenu игнорируется
            if (e.pointerType === 'touch' || window.matchMedia("(pointer: coarse)").matches) {
                e.preventDefault();
                return;
            }
            e.preventDefault();
            executeRowDeletion(row, numCell.textContent);
        });
    }
    // Безопасное удаление строк с жестким запретом на ликвидацию единственной записи
    function executeRowDeletion(row, rowNum) {
        const allRows = tableBody.querySelectorAll("tr");
        if (allRows.length <= 1) {
            alert("⚠️ Отказано в доступе. Невозможно удалить единственную строку таблицы.");
            return;
        }

        if (confirm(`Вы действительно хотите удалить строку №${rowNum}?`)) {
            const currentIndex = Array.from(allRows).indexOf(row);
            row.remove();
            
            // Определяем безопасный индекс для старта пересчета каскада
            const remainingRows = tableBody.querySelectorAll("tr");
            const nextStart = currentIndex >= remainingRows.length ? remainingRows.length - 1 : currentIndex;
            recalculateBalancesFrom(nextStart >= 0 ? nextStart : 0);
        }
    }

    // Хэндлеры открытия кастомных интерфейсов сносок
    function openEditModal(inputEl) {
        activeCommentInput = inputEl;
        modalShortInput.value = inputEl.value;
        modalFullInput.value = inputEl.getAttribute("data-full-comment") || "";
        commentModal.classList.add("active");
        modalShortInput.focus();
    }

    function openViewModal(inputEl) {
        viewFullText.textContent = inputEl.getAttribute("data-full-comment") || "Нет развернутого описания.";
        viewModal.classList.add("active");
    }

    modalOk.addEventListener("click", () => {
        if (activeCommentInput) {
            activeCommentInput.value = modalShortInput.value.trim();
            activeCommentInput.setAttribute("data-full-comment", modalFullInput.value.trim());
        }
        commentModal.classList.remove("active");
        activeCommentInput = null;
        saveDataToStorage();
    });

    modalCancel.addEventListener("click", () => {
        commentModal.classList.remove("active");
        activeCommentInput = null;
    });

    viewClose.addEventListener("click", () => {
        viewModal.classList.remove("active");
    });

    // --- Механика Исчезающего Скролл-Виджета ---
    function updateWidgetVisibility() {
        const scrollHeight = document.documentElement.scrollHeight;
        const clientHeight = document.documentElement.clientHeight;
        
        if (scrollHeight > clientHeight + 50) {
            navWidget.classList.add("visible");
            triggerWidgetFadeout();
        } else {
            navWidget.classList.remove("visible");
        }
    }

    function triggerWidgetFadeout() {
        if (isDragging) return;
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            if (!isDragging) {
                navWidget.classList.remove("visible");
            }
        }, 2000);
    }

    function updateSliderPosition() {
        if (isDragging) return;
        const scrollTop = window.scrollY;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        if (maxScroll <= 0) return;
        
        const percent = scrollTop / maxScroll;
        const maxTrack = navTrack.clientHeight - navSlider.clientHeight;
        navSlider.style.top = (percent * maxTrack) + "px";
    }

    document.getElementById("nav-top").addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        updateWidgetVisibility();
    });

    document.getElementById("nav-bottom").addEventListener("click", () => {
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        updateWidgetVisibility();
    });

    window.addEventListener("scroll", () => {
        updateSliderPosition();
        updateWidgetVisibility();
    });

    // Сквозной Drag-and-Drop ползунка скролла
    function onDragStart(e) {
        isDragging = true;
        startY = e.clientY || (e.touches && e.touches.clientY);
        startTop = parseInt(window.getComputedStyle(navSlider).top) || 0;
        document.body.style.userSelect = "none";
        navWidget.classList.add("visible");
    }

    function onDragMove(e) {
        if (!isDragging) return;
        const clientY = e.clientY || (e.touches && e.touches.clientY);
        const deltaY = clientY - startY;
        const maxTrack = navTrack.clientHeight - navSlider.clientHeight;
        
        let newTop = startTop + deltaY;
        if (newTop < 0) newTop = 0;
        if (newTop > maxTrack) newTop = maxTrack;
        
        navSlider.style.top = newTop + "px";
        
        const percent = newTop / maxTrack;
        const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
        window.scrollTo(0, percent * maxScroll);
    }

    function onDragEnd() {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = "";
        triggerWidgetFadeout();
    }

    navSlider.addEventListener("mousedown", onDragStart);
    navSlider.addEventListener("touchstart", onDragStart, { passive: false });

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("touchmove", onDragMove, { passive: false });

    document.addEventListener("mouseup", onDragEnd);
    document.addEventListener("touchend", onDragEnd);
    // --- Защита от клавиатуры: скрытие нижней панели кнопок ---
    if (window.visualViewport) {
        let initialHeight = window.visualViewport.height;
        window.visualViewport.addEventListener("resize", () => {
            if (window.visualViewport.height < initialHeight - 150) {
                bottomPanel.classList.add("keyboard-active");
            } else {
                bottomPanel.classList.remove("keyboard-active");
                initialHeight = window.visualViewport.height;
            }
        });
    }

    // --- Модуль Локальной БД и Бэкапов (JSON) ---
    function saveDataToStorage() {
        const rows = tableBody.querySelectorAll("tr");
        const data = [];
        rows.forEach(row => {
            const dVal = row.querySelector(".cell-date").value;
            const iVal = row.querySelector(".cell-income").value;
            const eVal = row.querySelector(".cell-expense").value;
            const cInput = row.querySelector(".cell-comment");
            
            // Сохраняем строку, только если в ней есть хоть какие-то данные
            if (dVal || iVal || eVal || cInput.value) {
                data.push({
                    date: dVal,
                    income: iVal,
                    expense: eVal,
                    shortComment: cInput.value,
                    fullComment: cInput.getAttribute("data-full-comment") || ""
                });
            }
        });
        localStorage.setItem("finance_book_data", JSON.stringify(data));
    }

    function loadDataFromStorage() {
        const raw = localStorage.getItem("finance_book_data");
        
        // КРИТИЧЕСКИЙ ФИКС СБРОСА: Если данных нет, полностью вычищаем DOM до одной чистой строки
        if (!raw) {
            tableBody.innerHTML = `
                <tr data-row="1">
                    <td class="row-number">0001</td>
                    <td><input type="text" inputmode="numeric" class="cell-date" value="" placeholder="ДД.ММ.ГГГГ" maxlength="10"></td>
                    <td><input type="text" inputmode="decimal" class="cell-income" placeholder="0,00"></td>
                    <td><input type="text" inputmode="decimal" class="cell-expense" placeholder="0,00"></td>
                    <td class="cell-balance"></td>
                    <td><input type="text" class="cell-comment" placeholder="" readonly data-full-comment="" tabindex="-1" disabled></td>
                </tr>
            `;
            initRowEvents(tableBody.querySelector("tr"));
            recalculateBalancesFrom(0);
            return;
        }

        try {
            const data = JSON.parse(raw);
            if (data.length === 0) {
                localStorage.removeItem("finance_book_data");
                loadDataFromStorage();
                return;
            }
            
            tableBody.innerHTML = ""; 
            data.forEach(item => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td class="row-number">0000</td>
                    <td><input type="text" inputmode="numeric" class="cell-date" value="${item.date}" placeholder="ДД.ММ.ГГГГ" maxlength="10"></td>
                    <td><input type="text" inputmode="decimal" class="cell-income" value="${item.income}" placeholder="0,00"></td>
                    <td><input type="text" inputmode="decimal" class="cell-expense" value="${item.expense}" placeholder="0,00"></td>
                    <td class="cell-balance"></td>
                    <td><input type="text" class="cell-comment" value="${item.shortComment}" placeholder="" readonly data-full-comment="${item.fullComment}" tabindex="-1"></td>
                `;
                tableBody.appendChild(tr);
                initRowEvents(tr);
                
                const commentInput = tr.querySelector(".cell-comment");
                if (parseNumber(item.income) === 0 && parseNumber(item.expense) === 0) {
                    commentInput.disabled = true;
                }
            });
            recalculateBalancesFrom(0);
        } catch (e) {
            console.error("Ошибка парсинга локальной БД", e);
        }
    }

    // --- Обработчики статической панели управления в подвале ---
    document.getElementById("ctrl-search").addEventListener("click", openSearchModal);
    
    document.getElementById("ctrl-export").addEventListener("click", () => {
        const raw = localStorage.getItem("finance_book_data");
        if (!raw || raw === "[]") { alert("Таблица пуста. Экспортировать нечего."); return; }
        
        const blob = new Blob([raw], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `finance_book_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    });

    document.getElementById("ctrl-import").addEventListener("click", () => importFileInput.click());
    
    importFileInput.addEventListener("change", (e) => {
        const file = e.target.files;
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const parsed = JSON.parse(evt.target.result);
                if (!Array.isArray(parsed)) throw new Error();
                
                if (confirm("Импорт полностью перезапишет текущую базу данных. Продолжить?")) {
                    localStorage.setItem("finance_book_data", evt.target.result);
                    loadDataFromStorage();
                }
            } catch (err) {
                alert("Критическая ошибка: Вы выбрали несовместимый файл JSON.");
            }
            importFileInput.value = "";
        };
        reader.readAsText(file);
    });

    document.getElementById("ctrl-print").addEventListener("click", () => {
        window.print();
    });

    // Функция Полного Сброса книги с ОДНИМ строгим подтверждением
    document.getElementById("ctrl-reset").addEventListener("click", () => {
        if (confirm("🚨 КРИТИЧЕСКОЕ ДЕЙСТВИЕ!\n\nВы уверены, что хотите полностью стереть ВСЕ данные в расходной книжке? Это действие необратимо.")) {
            localStorage.removeItem("finance_book_data"); // Сносим базу
            loadDataFromStorage(); // Пересобираем чистый интерфейс
        }
    });

    // --- Логика Всеядного Умного Поиска ---
    function openSearchModal() {
        modalSearchInput.value = currentSearchQuery;
        searchModal.classList.add("active");
        modalSearchInput.focus();
        modalSearchInput.setSelectionRange(0, modalSearchInput.value.length);
    }

    function closeSearchModal() {
        searchModal.classList.remove("active");
    }

    function applySearchFilter() {
        const query = modalSearchInput.value.trim().toLowerCase().replace(/\s/g, '').replace(',', '.');
        currentSearchQuery = modalSearchInput.value.trim();

        const rows = tableBody.querySelectorAll("tr");

        rows.forEach(row => {
            const dateVal = row.querySelector(".cell-date").value.toLowerCase();
            const incomeVal = row.querySelector(".cell-income").value.toLowerCase().replace(/\s/g, '').replace(',', '.');
            const expenseVal = row.querySelector(".cell-expense").value.toLowerCase().replace(/\s/g, '').replace(',', '.');
            const balanceVal = row.querySelector(".cell-balance").textContent.toLowerCase().replace(/\s/g, '').replace(',', '.');
            
            const commentInput = row.querySelector(".cell-comment");
            const shortComment = commentInput.value.toLowerCase();
            const fullComment = (commentInput.getAttribute("data-full-comment") || "").toLowerCase();

            const isMatch = query === "" || 
                            dateVal.includes(query) || 
                            incomeVal.includes(query) || 
                            expenseVal.includes(query) || 
                            balanceVal.includes(query) ||
                            shortComment.includes(query) || 
                            fullComment.includes(query);

            row.style.display = isMatch ? "" : "none";
        });

        updateWidgetVisibility();
        updateSliderPosition();
    }

    searchModalOk.addEventListener("click", () => {
        applySearchFilter();
        closeSearchModal();
    });

    searchModalReset.addEventListener("click", () => {
        modalSearchInput.value = "";
        applySearchFilter();
        closeSearchModal();
    });

    searchModalCancel.addEventListener("click", closeSearchModal);

    modalSearchInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            applySearchFilter();
            closeSearchModal();
        }
    });

    // Запуск полного жизненного цикла приложения
    loadDataFromStorage();
});
