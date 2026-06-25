
function exportAsPDF() {
    try {
        html2pdf().set({
            margin: 0.5,
            filename: 'FlipBook.pdf',
            image: { type: 'jpeg', quality: 0.98 },
            html2canvas: { scale: 2 },
            jsPDF: { unit: 'in', format: 'a4', orientation: 'portrait' }
        }).from(document.getElementById('book')).save();
        showToast('PDF export started');
    } catch(e){ showMessage('PDF Error', e.message); }
}

const LANGS={
 en:{stats:'Statistics dashboard opened'},
 fr:{stats:'Tableau de statistiques ouvert'},
 es:{stats:'Panel de estadísticas abierto'}
};

// ==================== SUPABASE CLIENT (single, safe) ====================
const SUPABASE_URL = 'https://miiewkxzsffpaefgdztm.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1paWV3a3h6c2ZmcGFlZmdkenRtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxNjc4ODEsImV4cCI6MjA4Mjc0Mzg4MX0.fLN3Ncmqb_ynCAPQnNr0nKZ_S0olZ4kohu87M6-Luy8';

if (!window._flipbookSupabase) {
    window._flipbookSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}
const sb = window._flipbookSupabase;

// ==================== GLOBAL BOOK STATE ====================
let pages = [];
let currentPageIndex = 0; // 0 represents the Front Cover Closed state
let isFlipping = false;
let totalPages = 0;
const MAX_LINES = 27; // Explicitly locked to 27 line limit
let statsChart = null;
let currentUser = null;
let currentLang = "en";
let savedRange = null;

// ==================== HELPER FUNCTIONS (Modals) ====================
function showMessage(title, message, callback) {
    $('#messageTitle').text(title);
    $('#messageText').text(message);
    $('#messageOkBtn').off('click').on('click', function () {
        $('#messageModal').fadeOut(300);
        if (callback) callback();
    });
    $('#messageModal').fadeIn(300);
}

function showConfirm(title, message, onYes, onNo) {
    $('#confirmTitle').text(title);
    $('#confirmText').text(message);
    $('#confirmYesBtn').off('click').on('click', function () {
        $('#confirmModal').fadeOut(300);
        if (onYes) onYes();
    });
    $('#confirmNoBtn').off('click').on('click', function () {
        $('#confirmModal').fadeOut(300);
        if (onNo) onNo();
    });
    $('#confirmModal').fadeIn(300);
}

function showToast(msg) {
    $('#toastMsg').text(msg);
    $('#toast').addClass('show');
    setTimeout(() => $('#toast').removeClass('show'), 3000);
}

// ==================== LEGAL PAGE NAVIGATION ====================
function navigateToLegalPage(pageType) {
    const pages = {
        'privacy': './privacy-policy.html',
        'terms': './terms-of-use.html',
        'settings': './privacy-settings.html'
    };

    if (pages[pageType]) {
        window.location.href = pages[pageType];
    } else {
        showMessage("Navigation Error", "Could not find the requested page.");
    }
}

// ==================== AUTH & GREETING ====================
async function updateUserGreeting() {
    if (!currentUser) return;
    const hour = new Date().getHours();
    let timeGreeting = hour < 12 ? "Good morning" : (hour < 18 ? "Good afternoon" : "Good evening");

    try {
        const { data: profile } = await sb.from('profiles').select('firstname, avatar_url').eq('id', currentUser.id).single();
        const displayName = profile?.firstname || currentUser.email.split('@')[0];
        $("#greetingText").text(`${timeGreeting}, ${displayName}`);
        $("#dynamicGreeting").html(`📖 ${timeGreeting}, ${displayName}`);

        if (profile?.avatar_url) {
            $("#user-avatar-small").attr("src", profile.avatar_url);
        } else {
            const letter = displayName.charAt(0).toUpperCase();
            const svg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle fill='%23e4b363' cx='16' cy='16' r='16'/%3E%3Ctext fill='white' x='16' y='20' text-anchor='middle' font-size='14' font-family='Arial'%3E${letter}%3C/text%3E%3C/svg%3E`;
            $("#user-avatar-small").attr("src", svg);
        }
    } catch (error) {
        console.error("Error loading profile:", error);
    }
}

async function loadUserProfile() {
    if (!currentUser) return;
    try {
        const { data: profile } = await sb.from('profiles').select('firstname, avatar_url').eq('id', currentUser.id).single();
        if (!profile) {
            await sb.from('profiles').upsert({ id: currentUser.id, firstname: currentUser.email.split('@')[0] });
        }
        await updateUserGreeting();
    } catch (error) {
        console.error("Error in loadUserProfile:", error);
    }
}

// ==================== BOOK SAVING TO SUPABASE ====================
async function saveBookToCloud(bookName) {
    if (!currentUser) {
        showMessage("Sign in required", "You need to sign in to save your book to the cloud. Please sign in first.");
        return false;
    }

    const pagesData = pages.filter(p => !p.isStats).map(p => ({
        content: p.content,
        draggables: p.draggables || []
    }));

    const { error } = await sb.from('books').insert({
        user_id: currentUser.id,
        book_name: bookName,
        pages: pagesData,
        current_page: currentPageIndex,
        created_at: new Date()
    });

    if (error) {
        showToast("Error saving: " + error.message);
        return false;
    }

    showToast(`Book "${bookName}" saved to cloud!`);
    return true;
}

async function loadUserBooks() {
    if (!currentUser) return [];

    try {
        const { data, error } = await sb.from('books')
            .select('id, book_name, created_at')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });

        if (error) {
            console.error(error);
            return [];
        }
        return data;
    } catch (error) {
        console.error("Error loading books:", error);
        return [];
    }
}

async function loadBookById(bookId) {
    try {
        const { data, error } = await sb.from('books').select('*').eq('id', bookId).single();

        if (error) {
            showToast("Error loading book");
            return false;
        }

        let normalPages = data.pages.map(p => ({
            content: p.content,
            element: null,
            isStats: false,
            draggables: p.draggables || []
        }));

        pages = [...normalPages, createStatsPage()];
        currentPageIndex = Math.min(data.current_page, normalPages.length);
        renderBook();
        showToast(`Loaded "${data.book_name}"`);
        return true;
    } catch (error) {
        console.error("Error in loadBookById:", error);
        return false;
    }
}

function saveButtonHandler() {
    if (!currentUser) {
        showConfirm("Sign in required", "You are not signed in. Would you like to sign in now?", () => {
            document.getElementById('login-overlay').style.display = 'flex';
        });
    } else {
        const bookName = prompt("Enter a name for this book:", "My Story");
        if (bookName) saveBookToCloud(bookName);
    }
}

// ==================== LINE LIMIT WITH PROPER FORMATTING ====================
function enforceLineLimit($editor, pageIdx) {
    if (!$editor.length) return false;

    let plainText = $editor.text();
    let lines = plainText.split(/\r?\n/);
    let lineCount = lines.length;

    let $counter = $editor.closest('.page-content').find('.line-counter');
    if ($counter.length === 0) {
        $editor.closest('.page-content').append(`<div class="line-counter">${lineCount}/${MAX_LINES}</div>`);
    }

    $counter = $editor.closest('.page-content').find('.line-counter');
    $counter.text(`${lineCount}/${MAX_LINES}`);

    if (lineCount >= MAX_LINES - 2) {
        $counter.css({ color: '#c0392b', fontWeight: 'bold' });
    } else {
        $counter.css({ color: '#b48b3a', fontWeight: 'normal' });
    }

    if (lineCount > MAX_LINES) {
        let trimmed = lines.slice(0, MAX_LINES).join('\n');
        $editor.html(trimmed.replace(/\n/g, '<br>'));
        $counter.text(`${MAX_LINES}/${MAX_LINES}`).css({ color: '#c0392b', fontWeight: 'bold' });

        pages[pageIdx].content = $editor.html();
        autoSaveLocal();

        if (!isFlipping && currentPageIndex === pageIdx + 1 && currentPageIndex <= totalPages) {
            showMessage("Page Full ✓", `You've reached line ${MAX_LINES}. Turning page...`, () => {
                autoFlipForward();
            });
        }
        return true;
    }

    return false;
}

function autoFlipForward() {
    if (isFlipping) return;

    if (currentPageIndex >= totalPages) {
        addNewPageAuto();
        return;
    }
    flipForward();
}

function addNewPageAuto() {
    pages.splice(pages.length - 1, 0, {
        content: `<p>📝 New page (1/${MAX_LINES})</p>`,
        element: null,
        isStats: false,
        draggables: []
    });

    renderBook();
    currentPageIndex = pages.filter(p => !p.isStats).length;
    updateDisplay();
    autoSaveLocal();
    showToast(`✨ New page added automatically.`);
}

// ==================== STATISTICS ====================
function computeStats() {
    let words = 0, chars = 0, linesPerPage = [];

    pages.forEach((p, idx) => {
        if (p.isStats) return;

        let txt = $(p.content).text();
        chars += txt.length;
        words += txt.trim().split(/\s+/).filter(w => w.length).length;
        linesPerPage.push({ page: idx + 1, lines: txt.split(/\r?\n/).length });
    });

    return {
        words,
        chars,
        linesPerPage,
        totalPages: pages.filter(p => !p.isStats).length
    };
}

function updateStatsPage() {
    const stats = computeStats();
    const $statsPage = $('.stats-page');
    if (!$statsPage.length) return;

    $statsPage.find('.stat-words').text(stats.words);
    $statsPage.find('.stat-chars').text(stats.chars);
    $statsPage.find('.stat-pages').text(stats.totalPages);

    let totalLines = stats.linesPerPage.reduce((sum, p) => sum + p.lines, 0);
    $statsPage.find('.stat-lines').text(totalLines);

    const ctx = $statsPage.find('#linesChart')[0]?.getContext('2d');
    if (ctx) {
        if (statsChart) {
            statsChart.destroy();
        }

        statsChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: stats.linesPerPage.map(p => `Pg ${p.page}`),
                datasets: [{
                    label: 'Lines per page',
                    data: stats.linesPerPage.map(p => p.lines),
                    backgroundColor: '#e4b363'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                scales: {
                    y: {
                        beginAtZero: true,
                        max: MAX_LINES
                    }
                }
            }
        });
    }
}

function createStatsPage() {
    return {
        content: `<div class="stats-container">
            <div class="stats-cards">
                <div class="stat-card">
                    <h4>Total Words</h4>
                    <div class="stat-value stat-words">0</div>
                </div>
                <div class="stat-card">
                    <h4>Characters</h4>
                    <div class="stat-value stat-chars">0</div>
                </div>
                <div class="stat-card">
                    <h4>Pages Written</h4>
                    <div class="stat-value stat-pages">0</div>
                </div>
                <div class="stat-card">
                    <h4>Total Lines</h4>
                    <div class="stat-value stat-lines">0</div>
                </div>
            </div>
            <div class="stats-chart">
                <canvas id="linesChart" width="400" height="180"></canvas>
            </div>
            <div class="stats-map">
                <p>📊 Writing Progress Chart</p>
            </div>
        </div>`,
        isStats: true,
        draggables: []
    };
}

// ==================== DRAGGABLE & RESIZABLE ITEMS ====================
function makeDraggableResizable($el, pageIdx) {
    let dragging = false, startX, startY, left, top;
    let resizing = false, startW, startH, startResizeX, startResizeY;

    $el.on('mousedown', function (e) {
        if ($(e.target).hasClass('resize-handle')) {
            resizing = true;
            startW = $el.width();
            startH = $el.height();
            startResizeX = e.clientX;
            startResizeY = e.clientY;
            e.preventDefault();
            return;
        }

        if ($(e.target).closest('.item-toolbar').length) return;

        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        left = parseInt($el.css('left')) || 0;
        top = parseInt($el.css('top')) || 0;
        e.preventDefault();
    });

    $(document).on('mousemove', function (e) {
        if (dragging) {
            $el.css({
                left: left + (e.clientX - startX),
                top: top + (e.clientY - startY)
            });
        }

        if (resizing) {
            let newW = Math.max(50, startW + (e.clientX - startResizeX));
            let newH = Math.max(40, startH + (e.clientY - startResizeY));
            $el.width(newW).height(newH);
            $el.find('img, video').css({ width: '100%', height: 'auto' });
        }
    }).on('mouseup', function () {
        if (dragging || resizing) {
            dragging = false;
            resizing = false;
            saveDraggablesForPage(pageIdx);
            autoSaveLocal();
        }
    });

    $el.find('.delete-item').click(() => {
        $el.remove();
        saveDraggablesForPage(pageIdx);
        autoSaveLocal();
        showToast("Item removed");
    });
}

function saveDraggablesForPage(pageIdx) {
    let items = [];
    $(`.inner-page:not(.stats-page)[data-page="${pageIdx + 1}"] .draggable-item`).each(function () {
        items.push({
            html: $(this).prop('outerHTML'),
            left: $(this).css('left'),
            top: $(this).css('top'),
            width: $(this).css('width'),
            height: $(this).css('height')
        });
    });

    if (pages[pageIdx]) {
        pages[pageIdx].draggables = items;
    }
}

function loadDraggablesForPage(pageIdx) {
    let $container = $(`.inner-page:not(.stats-page)[data-page="${pageIdx + 1}"] .page-content`);
    if (!pages[pageIdx] || !pages[pageIdx].draggables) return;

    pages[pageIdx].draggables.forEach(item => {
        let $el = $(item.html);
        $el.css({
            left: item.left,
            top: item.top,
            width: item.width,
            height: item.height
        });
        $container.append($el);
        makeDraggableResizable($el, pageIdx);
    });
}

// ==================== MEDIA INSERTION ====================
function insertMedia(file, type) {
    let reader = new FileReader();

    reader.onload = function (e) {
        let $container = $(`.inner-page:not(.stats-page)[data-page="${currentPageIndex}"] .page-content`);

        let mediaTag = type === 'image'
            ? `<img src="${e.target.result}" style="max-width:100%; border-radius:8px;">`
            : `<video controls style="max-width:100%; border-radius:8px;"><source src="${e.target.result}" type="${file.type}"></video>`;

        let $item = $(`<div class="draggable-item" style="position:absolute; left:50px; top:50px;">
            <div class="resize-handle"></div>
            ${mediaTag}
            <div class="item-toolbar"><button class="delete-item">✖ Delete</button></div>
        </div>`);

        $container.css('position', 'relative').append($item);
        makeDraggableResizable($item, currentPageIndex - 1);
        saveDraggablesForPage(currentPageIndex - 1);
        autoSaveLocal();
        showToast(`${type === 'image' ? '🖼️ Image' : '🎥 Video'} inserted`);
    };

    reader.readAsDataURL(file);
}

function insertChart(type, data, labels) {
    let canvasId = 'chart_' + Date.now();
    let $container = $(`.inner-page:not(.stats-page)[data-page="${currentPageIndex}"] .page-content`);

    let $chartDiv = $(`<div class="draggable-item chart-container" style="position:absolute; left:50px; top:50px; width:260px;">
        <canvas id="${canvasId}"></canvas>
        <div class="item-toolbar"><button class="delete-item">✖ Delete</button></div>
        <div class="resize-handle"></div>
    </div>`);

    $container.css('position', 'relative').append($chartDiv);

    let ctx = document.getElementById(canvasId).getContext('2d');
    let chart = new Chart(ctx, {
        type: type,
        data: {
            labels: labels,
            datasets: [{
                label: 'Data',
                data: data,
                backgroundColor: '#e4b363'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true
        }
    });

    $chartDiv[0].chart = chart;
    makeDraggableResizable($chartDiv, currentPageIndex - 1);
    saveDraggablesForPage(currentPageIndex - 1);
    autoSaveLocal();
    showToast("📊 Chart inserted");
}

// ==================== DRAWING CANVAS ====================
function initDrawingModal() {
    let canvas = document.getElementById('drawCanvas');
    if (!canvas) return;

    canvas.width = 500;
    canvas.height = 300;

    let ctx = canvas.getContext('2d');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    let painting = false;

    function startDraw(e) {
        painting = true;
        draw(e);
    }

    function endDraw() {
        painting = false;
        ctx.beginPath();
    }

    function draw(e) {
        if (!painting) return;

        let rect = canvas.getBoundingClientRect();
        let scaleX = canvas.width / rect.width;
        let scaleY = canvas.height / rect.height;
        let x = (e.clientX - rect.left) * scaleX;
        let y = (e.clientY - rect.top) * scaleY;

        ctx.lineWidth = $('#drawSize').val();
        ctx.lineCap = 'round';
        ctx.strokeStyle = $('#drawColor').val();
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x, y);
    }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', endDraw);
    canvas.addEventListener('mouseleave', endDraw);

    $('#clearCanvasBtn').off('click').click(() => {
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    });

    $('#insertDrawingBtn').off('click').click(() => {
        let dataURL = canvas.toDataURL();
        let $container = $(`.inner-page:not(.stats-page)[data-page="${currentPageIndex}"] .page-content`);

        let $img = $(`<div class="draggable-item" style="position:absolute; left:50px; top:50px;">
            <img src="${dataURL}" style="max-width:200px; border-radius:8px;">
            <div class="resize-handle"></div>
            <div class="item-toolbar"><button class="delete-item">✖ Delete</button></div>
        </div>`);

        $container.css('position', 'relative').append($img);
        makeDraggableResizable($img, currentPageIndex - 1);
        saveDraggablesForPage(currentPageIndex - 1);
        autoSaveLocal();
        showToast("🎨 Drawing inserted");
        $('#drawingModal').fadeOut(300);
    });
}

// ==================== BOOK RENDERING & MANAGEMENT ====================
function renderBook() {
    const $book = $('#book');
    $book.find('.inner-page').remove();

    for (let i = 0; i < pages.length; i += 2) {
        const pLeftNum = i + 1;
        const pRightNum = i + 2;

        let leftPageContent = pages[i] ? pages[i].content : '';
        let rightPageContent = pages[i+1] ? pages[i+1].content : '';
        
        let leftIsStats = pages[i] ? pages[i].isStats : false;
        let rightIsStats = pages[i+1] ? pages[i+1].isStats : false;

        if (!pages[i] && !pages[i+1]) continue;

        let html = `<div class="page page-front inner-page" data-spread-index="${i}">`;
        
      
        if (pages[i+1]) {
            if (rightIsStats) {
                html += `<div class="page-content stats-page">
                            <div class="stats-content">${rightPageContent}</div>
                            <div class="page-number">📊</div>
                         </div>`;
            } else {
                html += `<div class="page-content">
                            <div id="editor-pg-${pRightNum}" class="ruled-content" contenteditable="true">${rightPageContent}</div>
                            <div class="page-number">${pRightNum}</div>
                            <div class="line-counter">0/${MAX_LINES}</div>
                         </div>`;
            }
        } else {
            html += `<div class="page-content"><div class="ruled-content"></div></div>`;
        }

        // Left Side Back Sheet (Even Pages or Left Side Stats) - Visible after page flips over
        if (pages[i]) {
            if (leftIsStats) {
                html += `<div class="page-back stats-page">
                            <div class="stats-content">${leftPageContent}</div>
                            <div class="page-number">📊</div>
                         </div>`;
            } else {
                html += `<div class="page-back">
                            <div class="page-content">
                                <div id="editor-pg-${pLeftNum}" class="ruled-content" contenteditable="true">${leftPageContent}</div>
                                <div class="page-number">${pLeftNum}</div>
                                <div class="line-counter">0/${MAX_LINES}</div>
                            </div>
                         </div>`;
            }
        } else {
            html += `<div class="page-back"><div class="page-content"><div class="ruled-content"></div></div></div>`;
        }

        html += `</div>`;
        $('#coverRight').before(html);
    }

    bindPageEvents();
    updatePageNumbers();
    updateDisplay();
    refreshAllCounters();
}

function updateZindex() {
    const baseZ = 10;
    totalPages = pages.filter(p => !p.isStats).length;

    if (currentPageIndex === 0) {
        // Front Cover Fully Closed
        $('#coverLeft').css({ transform: 'rotateY(0deg)', zIndex: baseZ + 100, pointerEvents: 'auto' });
        $('#coverRight').css({ transform: 'rotateY(0deg)', zIndex: baseZ, pointerEvents: 'none' });
        $('.inner-page').css({ transform: 'rotateY(0deg)', zIndex: baseZ, display: 'none' });
    } else if (currentPageIndex >= totalPages + 1) {
        // Back Cover Sealed Shut or Stats End Screen Closed
        $('#coverLeft').css({ transform: 'rotateY(-180deg)', zIndex: baseZ, pointerEvents: 'none' });
        $('#coverRight').css({ transform: 'rotateY(-180deg)', zIndex: baseZ + 100, pointerEvents: 'auto' });
        $('.inner-page').css({ transform: 'rotateY(-180deg)', zIndex: baseZ, display: 'none' });
    } else {
        // Book Is Open Flat - Covers Lay Fully Unfolded flat to background layers
        $('#coverLeft').css({ transform: 'rotateY(-180deg)', zIndex: baseZ, pointerEvents: 'none' });
        $('#coverRight').css({ transform: 'rotateY(0deg)', zIndex: baseZ, pointerEvents: 'none' });
        
        $('.inner-page').each(function () {
            const spreadIdx = parseInt($(this).data('spread-index'));
            
            if (spreadIdx < currentPageIndex - 1) {
                // Already flipped pages stack turned cleanly over onto left side
                $(this).css({ transform: 'rotateY(-180deg)', zIndex: baseZ + spreadIdx, display: 'block' });
                $(this).find('.page-back').css({ pointerEvents: 'none' });
                $(this).find('.page-content').not('.page-back').css({ pointerEvents: 'none' });
            } else if (spreadIdx === currentPageIndex - 1) {
                // Active, open page leaf spread
                $(this).css({ transform: 'rotateY(0deg)', zIndex: baseZ + 50, display: 'block' });
                // Left and right sheets inside active spread both accept pointer interactions and inputs
                $(this).find('.page-back, .page-content').css({ pointerEvents: 'auto' });
            } else {
                // Future unflipped pages stack waiting underneath right side pane
                $(this).css({ transform: 'rotateY(0deg)', zIndex: baseZ + (100 - spreadIdx), display: 'block' });
                $(this).find('.page-back').css({ pointerEvents: 'none' });
                $(this).find('.page-content').not('.page-back').css({ pointerEvents: 'none' });
            }
        });
    }
}
function flipForward() {
    if (isFlipping) return;
    if (currentPageIndex >= totalPages + 2) return;

    isFlipping = true;

    if (currentPageIndex === 0) {
        // Flip front cover open realistically
        $('#coverLeft').css({ transform: 'rotateY(-180deg)' });
        setTimeout(() => {
            currentPageIndex = 1;
            updateDisplay();
            isFlipping = false;
        }, 600);
    } else if (currentPageIndex === totalPages + 1) {
        // Close back cover flap shut
        $('#coverRight').css({ transform: 'rotateY(-180deg)' });
        setTimeout(() => {
            currentPageIndex = totalPages + 2;
            updateDisplay();
            isFlipping = false;
        }, 600);
    } else {
        // Flip internal sheet spread forward
        const $leftPage = $(`.inner-page[data-page="${currentPageIndex}"]`);
        const $rightPage = $(`.inner-page[data-page="${currentPageIndex + 1}"]`);
        
        $rightPage.addClass('flipping-forward');
        setTimeout(() => {
            currentPageIndex += 2;
            if (currentPageIndex > totalPages) currentPageIndex = totalPages + 1;
            $rightPage.removeClass('flipping-forward');
            updateDisplay();
            isFlipping = false;
        }, 550);
    }
}

function flipBackward() {
    if (isFlipping) return;
    if (currentPageIndex === 0) return;

    isFlipping = true;

    if (currentPageIndex === totalPages + 2) {
        // Open back cover frame
        $('#coverRight').css({ transform: 'rotateY(0deg)' });
        setTimeout(() => {
            currentPageIndex = totalPages + 1;
            updateDisplay();
            isFlipping = false;
        }, 600);
    } else if (currentPageIndex === 1) {
        // Seal front cover completely closed
        $('#coverLeft').css({ transform: 'rotateY(0deg)' });
        setTimeout(() => {
            currentPageIndex = 0;
            updateDisplay();
            isFlipping = false;
        }, 600);
    } else {
        // Flip internal sheets backward safely
        let prevIndex = currentPageIndex - 2;
        if (currentPageIndex === totalPages + 1) {
            prevIndex = totalPages % 2 === 0 ? totalPages - 1 : totalPages;
        }
        
        const $prevLeftPage = $(`.inner-page[data-page="${prevIndex}"]`);
        $prevLeftPage.addClass('flipping-backward');
        
        setTimeout(() => {
            currentPageIndex = prevIndex;
            $prevLeftPage.removeClass('flipping-backward');
            updateDisplay();
            isFlipping = false;
        }, 550);
    }
}

function bindPageEvents() {
    $('.inner-page:not(.stats-page)').each(function (i) {
        if (!pages[i] || pages[i].isStats) return;

        pages[i].element = $(this);
        const $ruled = $(this).find('.ruled-content');

        $ruled.off('input keyup paste blur');

        $ruled.on('input', function () {
            pages[i].content = $(this).html();
            enforceLineLimit($(this), i);
            autoSaveLocal();
            updateStatsPage();
        });

        $ruled.on('keyup', function () {
            setTimeout(() => {
                enforceLineLimit($(this), i);
                updateStatsPage();
            }, 10);
        });

        $ruled.on('paste', function () {
            setTimeout(() => {
                enforceLineLimit($(this), i);
                updateStatsPage();
                autoSaveLocal();
            }, 20);
        });

        $ruled.on('blur', function () {
            enforceLineLimit($(this), i);
            updateStatsPage();
            autoSaveLocal();
        });
    });

    totalPages = pages.filter(p => !p.isStats).length;
    $('#totalPages').text(totalPages);
}

function refreshAllCounters() {
    $('.inner-page:not(.stats-page)').each(function (i) {
        if (pages[i] && !pages[i].isStats) {
            enforceLineLimit($(this).find('.ruled-content'), i);
        }
    });
}

function updatePageNumbers() {
    let pgNum = 1;
    $('.inner-page:not(.stats-page)').each(function () {
        $(this).find('.page-number').text(pgNum++);
    });
    $('.stats-page .page-number').text('📊');
}

function updateZindex() {
    // Structural index rules to ensure clean 3D card layout layers
    const baseZ = 10;
    
    if (currentPageIndex === 0) {
        // Front Cover Closed
        $('#coverLeft').css({ transform: 'rotateY(0deg)', zIndex: baseZ + 20, display: 'block' });
        $('#coverRight').css({ transform: 'rotateY(0deg)', zIndex: baseZ, display: 'block' });
        $('.inner-page, .stats-page').css({ display: 'none' });
    } else if (currentPageIndex === totalPages + 1) {
        // Stats Sheet Display Frame
        $('#coverLeft').css({ transform: 'rotateY(-180deg)', zIndex: baseZ, display: 'block' });
        $('#coverRight').css({ transform: 'rotateY(0deg)', zIndex: baseZ, display: 'block' });
        $('.inner-page:not(.stats-page)').css({ display: 'none' });
        $('.stats-page').css({ zIndex: baseZ + 10, display: 'block', transform: 'rotateY(0deg)' });
    } else if (currentPageIndex === totalPages + 2) {
        // Back Cover Sealed Completely
        $('#coverLeft').css({ transform: 'rotateY(-180deg)', zIndex: baseZ, display: 'block' });
        $('#coverRight').css({ transform: 'rotateY(-180deg)', zIndex: baseZ + 20, display: 'block' });
        $('.inner-page, .stats-page').css({ display: 'none' });
    } else {
        // Standard Open Double Page Frame
        $('#coverLeft').css({ transform: 'rotateY(-180deg)', zIndex: baseZ, display: 'block' });
        $('#coverRight').css({ transform: 'rotateY(0deg)', zIndex: baseZ, display: 'block' });
        
        $('.inner-page').each(function () {
            const p = parseInt($(this).data('page'));
            if (p === currentPageIndex) {
                // Active reading left side sheet pane
                $(this).css({ zIndex: baseZ + 15, display: 'block', transform: 'rotateY(-180deg)' });
            } else if (p === currentPageIndex + 1) {
                // Active reading right side sheet pane
                $(this).css({ zIndex: baseZ + 14, display: 'block', transform: 'rotateY(0deg)' });
            } else {
                $(this).css({ display: 'none' });
            }
        });
        $('.stats-page').css({ display: 'none' });
    }
}

function updateDisplay() {
    if (currentPageIndex === 0) {
        $('#currentPage').text('Cover');
    } else if (currentPageIndex === totalPages + 1) {
        $('#currentPage').text('Stats');
        updateStatsPage();
    } else if (currentPageIndex === totalPages + 2) {
        $('#currentPage').text('Back');
    } else {
        $('#currentPage').text(`${currentPageIndex}-${Math.min(currentPageIndex + 1, totalPages)}`);
    }
    updateZindex();
}

// ==================== BOOK FLIPPING (FIXED & REALISTIC) ====================
function flipForward() {
    if (isFlipping) return;

    if (currentPageIndex >= totalPages + 2) {
        showMessage("End of Book", "You've reached the back cover.");
        return;
    }

    isFlipping = true;

    if (currentPageIndex === 0) {
        // Open front cover seamlessly
        $('#coverLeft').addClass('flipping');
        setTimeout(() => {
            currentPageIndex = 1;
            updateDisplay();
            $('#coverLeft').removeClass('flipping');
            isFlipping = false;
            autoSaveLocal();
            showMessage("📖 Book Opened", "Welcome to your 3D FlipBook! You have a strict 27-line limit per page.");
        }, 500);
    } else if (currentPageIndex === totalPages) {
        // Transition directly into Stats frame
        currentPageIndex = totalPages + 1;
        updateDisplay();
        isFlipping = false;
    } else if (currentPageIndex === totalPages + 1) {
        // Flip to seal back cover shut
        $('#coverRight').addClass('flipping');
        setTimeout(() => {
            currentPageIndex = totalPages + 2;
            updateDisplay();
            $('#coverRight').removeClass('flipping');
            isFlipping = false;
        }, 500);
    } else {
        // Standard double page transformation pass
        const $page = $(`.inner-page[data-page="${currentPageIndex}"]`);
        if ($page.length) {
            $page.addClass('flipping');
            setTimeout(() => {
                currentPageIndex += 2; // Step forward past both layered side panes
                if (currentPageIndex > totalPages) currentPageIndex = totalPages + 1;
                updateDisplay();
                $page.removeClass('flipping');
                isFlipping = false;
                autoSaveLocal();
            }, 550);
        } else {
            currentPageIndex = Math.min(currentPageIndex + 2, totalPages + 1);
            updateDisplay();
            isFlipping = false;
        }
    }
}

function flipBackward() {
    if (isFlipping) return;

    if (currentPageIndex <= 0) {
        showMessage("Front Cover", "You're already at the cover.");
        return;
    }

    isFlipping = true;

    if (currentPageIndex === totalPages + 2) {
        // Open back cover frame gracefully back up
        $('#coverRight').addClass('flipping');
        setTimeout(() => {
            currentPageIndex = totalPages + 1;
            updateDisplay();
            $('#coverRight').removeClass('flipping');
            isFlipping = false;
        }, 500);
    } else if (currentPageIndex === totalPages + 1) {
        // Return back into standard sheets loop
        currentPageIndex = Math.max(1, totalPages % 2 === 0 ? totalPages - 1 : totalPages);
        updateDisplay();
        isFlipping = false;
    } else if (currentPageIndex === 1) {
        // Close the book entirely back onto front cover shell
        $('#coverLeft').addClass('flipping');
        setTimeout(() => {
            currentPageIndex = 0;
            updateDisplay();
            $('#coverLeft').removeClass('flipping');
            isFlipping = false;
            autoSaveLocal();
        }, 500);
    } else {
        // Standard double page back flip processing layout
        const $page = $(`.inner-page[data-page="${currentPageIndex - 2}"]`);
        if ($page.length) {
            $page.addClass('flipping');
            setTimeout(() => {
                currentPageIndex -= 2;
                updateDisplay();
                $page.removeClass('flipping');
                isFlipping = false;
                autoSaveLocal();
            }, 550);
        } else {
            currentPageIndex = Math.max(1, currentPageIndex - 2);
            updateDisplay();
            isFlipping = false;
        }
    }
}

function attachPageClicks() {
    $('.book').off('click', '.page, .cover').on('click', function (e) {
        if (isFlipping) return;

        // Prevent layout content inputs editing flags from counting as simple clicks
        if ($(e.target).is('[contenteditable="true"]') || $(e.target).closest('.draggable-item').length) return;

        const rect = this.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const w = rect.width;

        if (x > w * 0.5) {
            flipForward();
        } else {
            flipBackward();
        }
    });
}

function addNewPage() {
    if (isFlipping) return;

    // Splice in pairs to properly service double spread panel stacks
    pages.splice(pages.length - 1, 0, 
        { content: `<p>📝 New Page Content (${pages.length}/${MAX_LINES})</p>`, isStats: false, draggables: [] },
        { content: `<p>📝 New Page Content (${pages.length + 1}/${MAX_LINES})</p>`, isStats: false, draggables: [] }
    );

    renderBook();
    currentPageIndex = Math.max(1, pages.filter(p => !p.isStats).length - 1);
    updateDisplay();
    autoSaveLocal();
    showToast(`✨ Added new page spread.`);
}

function deleteCurrentPage() {
    if (isFlipping) return;

    if (currentPageIndex <= 0 || currentPageIndex > totalPages) {
        showMessage("Cannot Delete", "You cannot delete the cover or the statistics page.");
        return;
    }

    if (totalPages <= 2) {
        showMessage("Cannot Delete", "You must keep at least one base page spread.");
        return;
    }

    showConfirm("Delete Page Spread", `Delete current open page spread contents?`, function () {
        let normal = pages.filter(p => !p.isStats);
        // Clean out target pair cleanly
        let targetIndex = currentPageIndex - 1;
        normal.splice(targetIndex, 2);
        
        pages = [...normal, pages.find(p => p.isStats)];
        currentPageIndex = Math.max(1, targetIndex - 1);

        renderBook();
        autoSaveLocal();
        showToast("🗑️ Page spread deleted");
        updateStatsPage();
    });
}

function showStatsDashboard() {
    if (currentPageIndex !== totalPages + 1) {
        currentPageIndex = totalPages + 1;
        updateDisplay();
    }
    showToast("📊 Statistics dashboard opened");
}

function openPageManager() {
    let $list = $("#pageList");
    $list.empty();

    let normalPages = pages.filter(p => !p.isStats);
    normalPages.forEach((p, idx) => {
        let preview = $(p.content).text().substring(0, 50);
        $list.append(`<div class="page-list-item">
            <input type="checkbox" class="page-checkbox" data-page="${idx + 1}">
            <span>Page ${idx + 1}: ${preview}...</span>
        </div>`);
    });

    $("#pageManagerModal").fadeIn(300);
}

function deleteSelectedPages() {
    let selected = [];
    $(".page-checkbox:checked").each(function () {
        selected.push(parseInt($(this).data("page")));
    });

    if (selected.length === 0) {
        showMessage("No Selection", "Please select pages to delete.");
        return;
    }

    showConfirm("Delete Pages", `Delete ${selected.length} page(s)?`, function () {
        let normal = pages.filter(p => !p.isStats);
        let newNormal = normal.filter((_, idx) => !selected.includes(idx + 1));

        if (newNormal.length === 0) {
            newNormal = [{ content: "<p>New first page</p>", isStats: false, draggables: [] }];
        }

        pages = [...newNormal, pages.find(p => p.isStats)];
        currentPageIndex = 1;

        renderBook();
        autoSaveLocal();
        showToast("🗑️ Pages deleted.");
        $("#pageManagerModal").fadeOut(300);
        updateStatsPage();
    });
}

// ==================== EXPORT FUNCTIONS ====================
function exportAsWord() {
    let content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>My FlipBook</title></head><body>`;

    pages.filter(p => !p.isStats).forEach((p, i) => {
        content += `<div style="page-break-after:always;"><h2>Page ${i + 1}</h2>${p.content}</div>`;
    });

    content += `</body></html>`;
    const blob = new Blob([content], { type: "application/msword" });
    saveAs(blob, "my_flipbook.doc");
    showToast("📝 Exporting Word document...");
}

function exportTXT() {
    let content = "=== 3D FLIPBOOK EXPORT ===\n\n";

    pages.filter(p => !p.isStats).forEach((p, i) => {
        content += `PAGE ${i + 1}:\n${$(p.content).text()}\n\n---\n\n`;
    });

    const blob = new Blob([content], { type: "text/plain" });
    saveAs(blob, "my_flipbook.txt");
    showToast("✅ Export complete");
}

// ==================== LOCAL STORAGE ====================
function autoSaveLocal() {
    let saveContent = pages.filter(p => !p.isStats).map(p => ({
        content: p.content,
        draggables: p.draggables || []
    }));

    localStorage.setItem('flipbook_autosave', JSON.stringify({
        pages: saveContent,
        currentPage: currentPageIndex
    }));
}

function loadAutoSave() {
    let auto = localStorage.getItem('flipbook_autosave');
    if (auto) {
        try {
            let data = JSON.parse(auto);
            let normalPages = data.pages.map(p => ({
                content: p.content,
                element: null,
                isStats: false,
                draggables: p.draggables || []
            }));

            pages = [...normalPages, createStatsPage()];
            currentPageIndex = Math.min(data.currentPage, normalPages.length);
            renderBook();
            showToast("✨ Auto-save restored");
            updateStatsPage();
        } catch (error) {
            console.error("Error loading auto-save:", error);
            initBook();
        }
    }
}

// ==================== INITIALIZATION ====================
async function initBook() {
    pages = [];
    let normalPages = [
        {
            content: '<p>📖 <strong>Welcome to 3D FlipBook!</strong></p><p>Each page has a strict <strong>27‑line limit</strong> – the page will auto-flip when you reach the limit.</p><p>Sign in to save your books to the cloud.</p>',
            isStats: false,
            draggables: []
        },
        {
            content: '<p>✨ <strong>Amazing Features</strong></p><p>• Realistic 3D flipping animation</p><p>• Auto page turn at line 27</p><p>• Insert images, videos, charts, drawings</p><p>• Cloud save with Supabase</p><p>• Page Manager (Shredder)</p>',
            isStats: false,
            draggables: []
        },
        {
            content: '<p>🎉 <strong>Try the new features!</strong></p><p>Click "Pages" to delete multiple pages.</p><p>Use "Stats" to see your writing progress.</p>',
            isStats: false,
            draggables: []
        },
        {
            content: '<p>📝 <strong>Start Writing Below...</strong></p><p>Type here directly or replace this boilerplate text to build out your customizable interactive document spreads.</p>',
            isStats: false,
            draggables: []
        }
    ];

    pages = [...normalPages, createStatsPage()];
    renderBook();
    attachPageClicks();
}

// ==================== AUTH EVENT HANDLERS ====================
async function handleLogin(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });

    if (error) {
        showMessage("Login Failed", error.message);
        return false;
    }

    currentUser = data.user;
    localStorage.setItem('flipbook_user', JSON.stringify({ id: currentUser.id, email: currentUser.email }));

    await loadUserProfile();

    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';

    const books = await loadUserBooks();
    if (books.length > 0) {
        showConfirm("Load last book?", "Do you want to load your most recent book?", async () => {
            await loadBookById(books[0].id);
        }, () => {
            const saved = localStorage.getItem('flipbook_autosave');
            if (saved) loadAutoSave();
            else initBook();
        });
    } else {
        const saved = localStorage.getItem('flipbook_autosave');
        if (saved) loadAutoSave();
        else initBook();
    }

    return true;
}

async function handleSignup(name, email, password) {
    if (password.length < 6) {
        showMessage("Invalid Password", "Password must be at least 6 characters.");
        return false;
    }

    const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { firstname: name } }
    });

    if (error) {
        showMessage("Signup Failed", error.message);
        return false;
    }

    return await handleLogin(email, password);
}

async function handleLogout() {
    await sb.auth.signOut();
    currentUser = null;
    localStorage.removeItem('flipbook_user');

    document.getElementById('app-content').style.display = 'none';
    document.getElementById('login-overlay').style.display = 'flex';

    $('#login-email, #login-password, #signup-name, #signup-email, #signup-password').val('');
    showToast("Signed out successfully");
}

// ==================== DOM READY ====================
$(document).ready(async function () {
    const savedUser = localStorage.getItem('flipbook_user');

    if (savedUser) {
        try {
            const { data: { user } } = await sb.auth.getUser();

            if (user) {
                currentUser = user;
                document.getElementById('login-overlay').style.display = 'none';
                document.getElementById('app-content').style.display = 'block';

                await loadUserProfile();

                const books = await loadUserBooks();
                if (books.length) {
                    await loadBookById(books[0].id);
                } else {
                    const saved = localStorage.getItem('flipbook_autosave');
                    if (saved) loadAutoSave();
                    else initBook();
                }
            } else {
                document.getElementById('login-overlay').style.display = 'flex';
                document.getElementById('app-content').style.display = 'none';
            }
        } catch (error) {
            console.error("Auth error:", error);
            document.getElementById('login-overlay').style.display = 'flex';
            document.getElementById('app-content').style.display = 'none';
        }
    } else {
        document.getElementById('login-overlay').style.display = 'flex';
        document.getElementById('app-content').style.display = 'none';
    }

    // ========== AUTH FORMS ==========
    $('#login-form').on('submit', async (e) => {
        e.preventDefault();
        const email = $('#login-email').val();
        const password = $('#login-password').val();
        await handleLogin(email, password);
    });

    $('#signup-form').on('submit', async (e) => {
        e.preventDefault();
        const name = $('#signup-name').val();
        const email = $('#signup-email').val();
        const password = $('#signup-password').val();
        await handleSignup(name, email, password);
    });

    $('#show-signup-link').click((e) => {
        e.preventDefault();
        $('#login-step').hide();
        $('#signup-step').show();
    });

    $('#show-login-link').click((e) => {
        e.preventDefault();
        $('#signup-step').hide();
        $('#login-step').show();
    });

    $('#logoutBtn').click(handleLogout);

    // ========== FILE MANAGEMENT ==========
    $('#saveBtn, #saveBookNav').click(saveButtonHandler);

    $('#loadBtn, #loadBookNav').click(async () => {
        if (!currentUser) {
            showMessage("Sign in required", "Please sign in to load your books.");
            return;
        }

        const books = await loadUserBooks();
        const $select = $('#loadList');
        $select.empty();

        if (books.length === 0) {
            $select.append('<option disabled>No saved books</option>');
        } else {
            books.forEach(book => {
                $select.append(`<option value="${book.id}">${book.book_name} (${new Date(book.created_at).toLocaleDateString()})</option>`);
            });
        }

        $('#loadModal').fadeIn(300);
    });

    $('#confirmLoad').click(async () => {
        const bookId = parseInt($('#loadList').val());
        if (bookId) {
            await loadBookById(bookId);
            $('#loadModal').fadeOut(300);
        }
    });

    // ========== BOOK OPERATIONS ==========
    $('#newBtn, #newBookNav').click(() => {
        showConfirm("New Book", "Discard current book?", () => initBook());
    });

    $('#addPageBtn, #addPageNav').click(addNewPage);
    $('#delPageBtn, #deletePageNav').click(deleteCurrentPage);
    $('#wordCountBtn, #wordCountNav').click(showStatsDashboard);
    $('#pageManagerBtn, #pageManagerNav').click(openPageManager);
    $('#deleteSelectedPagesBtn').click(deleteSelectedPages);

    // ========== EXPORT ==========
    $('#exportPdfBtn, #exportPdfNav').click(exportAsPDF);
    $('#exportWordBtn, #exportWordNav').click(exportAsWord);
    $('#exportBtn, #exportTxtNav').click(exportTXT);
    $('#printBtn, #printBookNav').click(() => { showToast('Preparing print...'); setTimeout(()=>window.print(),300); });

    // ========== SHARING ==========
    $('#shareReddit').click(() => {
        window.open(`https://www.reddit.com/submit?title=${encodeURIComponent("My 3D FlipBook")}&url=${location.href}`);
    });
    $('#shareQuora').click(() => {
        window.open(`https://www.quora.com/q?q=${encodeURIComponent("My 3D FlipBook: " + location.href)}`);
    });

    // ========== NAVIGATION ==========
    $('#prevBtn').click(flipBackward);
    $('#nextBtn').click(flipForward);

    // ========== TEXT FORMATTING ==========
    $('#boldBtn').click(() => document.execCommand('bold'));
    $('#italicBtn').click(() => document.execCommand('italic'));
    $('#underlineBtn').click(() => document.execCommand('underline'));
    $('#alignLeftBtn').click(() => document.execCommand('justifyLeft'));
    $('#alignCenterBtn').click(() => document.execCommand('justifyCenter'));
    $('#alignRightBtn').click(() => document.execCommand('justifyRight'));

    $('#fontFamilySelect').change(function () {
        document.execCommand('fontName', false, $(this).val());
    });

    $('#fontSizeSelect').change(function () {
        let s = $(this).val();
        document.execCommand('fontSize', false, '7');
        $('font[size="7"]').each(function () {
            $(this).removeAttr('size').css('font-size', s + 'px');
        });
    });

    $('#textColorPicker').change(function () {
        document.execCommand('foreColor', false, $(this).val());
    });

    $('#bgColorPicker').change(function () {
        document.execCommand('backColor', false, $(this).val());
    });

    // ========== MEDIA INSERTION ==========
    $('#insertImageBtn, #mediaImageNav').click(() => {
        $('#mediaModalTitle').text('Insert Image');
        $('#mediaFile').attr('accept', 'image/*');
        $('#mediaFile').data('type', 'image');
        $('#mediaModal').fadeIn(300);
    });

    $('#insertVideoBtn, #mediaVideoNav').click(() => {
        $('#mediaModalTitle').text('Insert Video');
        $('#mediaFile').attr('accept', 'video/*');
        $('#mediaFile').data('type', 'video');
        $('#mediaModal').fadeIn(300);
    });

    $('#confirmMediaBtn').click(() => {
        let file = $('#mediaFile')[0].files[0];
        let type = $('#mediaFile').data('type');
        if (file) insertMedia(file, type);
        $('#mediaModal').fadeOut(300);
        $('#mediaFile').val('');
    });

    $('#insertChartBtn, #mediaChartNav').click(() => {
        $('#chartModal').fadeIn(300);
    });

    $('#insertChartConfirm').click(() => {
        let type = $('#chartTypeSelect').val();
        let data = $('#chartDataInput').val().split(',').map(Number);
        let labels = $('#chartLabelsInput').val().split(',');

        if (data.length && labels.length) {
            insertChart(type, data, labels);
            $('#chartModal').fadeOut(300);
            $('#chartDataInput, #chartLabelsInput').val('');
        } else {
            showMessage("Invalid Data", "Please enter both data and labels.");
        }
    });

    $('#openDrawingBtn, #mediaDrawNav').click(() => {
        initDrawingModal();
        $('#drawingModal').fadeIn(300);
    });

    // ========== LANGUAGE & SETTINGS ==========
    $('#languageSelect').change(function () {
        currentLang = $(this).val();
        showToast(`Language set to ${currentLang.toUpperCase()}`);
    });

    // ========== LEGAL PAGES ==========
    $('#privacyPolicyBtn, #footerPrivacy').click((e) => {
        e.preventDefault();
        navigateToLegalPage('privacy');
    });

    $('#termsOfUseBtn, #footerTerms').click((e) => {
        e.preventDefault();
        navigateToLegalPage('terms');
    });

    $('#privacySettingsBtn, #footerSettings').click((e) => {
        e.preventDefault();
        navigateToLegalPage('settings');
    });

    // ========== MODAL HANDLING ==========
    $('.close-modal').click(function () {
        $(this).closest('.modal').fadeOut(300);
    });

    $(window).click(e => {
        if ($(e.target).hasClass('modal')) {
            $(e.target).fadeOut(300);
        }
    });

    // ========== KEYBOARD SHORTCUTS ==========
    $(document).keydown(e => {
        if (e.key === 'ArrowRight') flipForward();
        if (e.key === 'ArrowLeft') flipBackward();
    });
});
