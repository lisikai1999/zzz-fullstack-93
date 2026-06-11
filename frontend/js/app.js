let currentSlideId = null;
let pollTimer = null;
let layerCount = 1;

document.addEventListener('DOMContentLoaded', () => {
    loadSlideList();
    initAnnotationEvents();
    setupToolbar();
    setupUpload();
    setupCompare();
    setupNcRatio();
    setupCalibration();
    setupDeconv();
    setupLayers();

    window.addEventListener('resize', () => {
        resizeAnnotationCanvas();
        renderAllAnnotations();
    });
});

async function loadSlideList() {
    try {
        const slides = await Api.getSlides();
        const select = document.getElementById('slide-select');
        select.innerHTML = '<option value="">-- 选择切片 --</option>';
        slides.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = `${s.display_name || s.filename} (${s.width}x${s.height})`;
            if (s.status !== 'ready') opt.textContent += ` [${s.status}]`;
            select.appendChild(opt);
        });

        select.addEventListener('change', () => {
            const id = parseInt(select.value);
            if (id) loadSlide(id);
        });
    } catch (err) {}
}

async function loadSlide(id) {
    try {
        const slide = await Api.getSlide(id);
        currentSlideId = id;

        if (slide.status !== 'ready') {
            document.getElementById('slide-status').textContent = `状态: ${slide.status}`;
            startPolling(id);
            return;
        }

        stopPolling();
        document.getElementById('slide-status').textContent = `${slide.width}x${slide.height} px`;

        if (slide.um_per_pixel) {
            document.getElementById('um-per-pixel').value = slide.um_per_pixel;
        } else {
            document.getElementById('um-per-pixel').value = '';
        }

        initViewer(slide);
        await loadAnnotations(id);
    } catch (err) {}
}

function startPolling(id) {
    stopPolling();
    pollTimer = setInterval(async () => {
        try {
            const slide = await Api.getSlide(id);
            if (slide.status === 'ready') {
                stopPolling();
                showToast('瓦片处理完成', 'success');
                loadSlide(id);
            } else if (slide.status.startsWith('error')) {
                stopPolling();
                showToast(`切片处理失败: ${slide.status}`, 'error');
            } else {
                document.getElementById('slide-status').textContent = `状态: ${slide.status}`;
            }
        } catch (err) {
            stopPolling();
        }
    }, 2000);
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function setupToolbar() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    });
    setTool('pan');
}

function setupUpload() {
    const dialog = document.getElementById('upload-dialog');
    const fileInput = document.getElementById('upload-input');

    document.getElementById('upload-btn').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', () => {
        if (fileInput.files.length > 0) {
            document.getElementById('upload-name').value = fileInput.files[0].name;
            dialog.classList.remove('hidden');
        }
    });

    document.getElementById('upload-cancel').addEventListener('click', () => {
        dialog.classList.add('hidden');
        fileInput.value = '';
    });

    document.getElementById('upload-confirm').addEventListener('click', async () => {
        const file = fileInput.files[0];
        if (!file) return;

        const name = document.getElementById('upload-name').value;
        const um = parseFloat(document.getElementById('upload-um').value) || null;

        document.getElementById('upload-progress').classList.remove('hidden');

        try {
            const slide = await Api.uploadSlide(file, name, um);
            document.getElementById('upload-progress').classList.add('hidden');
            dialog.classList.add('hidden');
            fileInput.value = '';

            await loadSlideList();
            document.getElementById('slide-select').value = slide.id;
            loadSlide(slide.id);
        } catch (err) {
            document.getElementById('upload-progress').classList.add('hidden');
        }
    });
}

function setupCompare() {
    document.getElementById('compare-btn').addEventListener('click', async () => {
        const aId = parseInt(document.getElementById('compare-a').value);
        const bId = parseInt(document.getElementById('compare-b').value);
        if (!aId || !bId || aId === bId) {
            showToast('请选择两个不同的标注进行对比', 'warn');
            return;
        }

        try {
            const result = await Api.compareAnnotations(aId, bId);
            const el = document.getElementById('compare-result');
            el.innerHTML = `
                <div class="measure-row"><span class="measure-label">IoU</span><span class="measure-value">${(result.iou * 100).toFixed(1)}%</span></div>
                <div class="measure-row"><span class="measure-label">Dice</span><span class="measure-value">${(result.dice * 100).toFixed(1)}%</span></div>
                <div class="measure-row"><span class="measure-label">交集(px)</span><span class="measure-value">${result.intersection_px.toLocaleString()}</span></div>
                <div class="measure-row"><span class="measure-label">并集(px)</span><span class="measure-value">${result.union_px.toLocaleString()}</span></div>
            `;
        } catch (err) {}
    });
}

function setupNcRatio() {
    document.getElementById('nc-ratio-btn').addEventListener('click', async () => {
        if (!currentSlideId || !viewer) {
            showToast('请先选择并加载切片', 'warn');
            return;
        }

        const bounds = getViewportBoundsImage();
        if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
            showToast('当前视野无效', 'warn');
            return;
        }

        try {
            showToast('正在计算核浆比...', 'info');
            const result = await Api.getNuclearRatio(currentSlideId, bounds);
            const el = document.getElementById('nc-ratio-result');
            el.innerHTML = `
                <div class="measure-row"><span class="measure-label">核浆比(N/C)</span><span class="measure-value">${result.nc_ratio.toFixed(4)}</span></div>
                <div class="measure-row"><span class="measure-label">细胞核面积(px)</span><span class="measure-value">${result.nuclear_area_px.toLocaleString()}</span></div>
                <div class="measure-row"><span class="measure-label">细胞浆面积(px)</span><span class="measure-value">${result.cytoplasm_area_px.toLocaleString()}</span></div>
                <div class="measure-row"><span class="measure-label">组织面积(px)</span><span class="measure-value">${result.tissue_area_px.toLocaleString()}</span></div>
                ${result.nuclear_area_um2 != null ? `<div class="measure-row"><span class="measure-label">核面积(µm²)</span><span class="measure-value">${result.nuclear_area_um2.toLocaleString()}</span></div>` : ''}
                ${result.cytoplasm_area_um2 != null ? `<div class="measure-row"><span class="measure-label">浆面积(µm²)</span><span class="measure-value">${result.cytoplasm_area_um2.toLocaleString()}</span></div>` : ''}
            `;
        } catch (err) {}
    });
}

function setupCalibration() {
    document.getElementById('save-calibration').addEventListener('click', async () => {
        if (!currentSlideId) {
            showToast('请先选择切片', 'warn');
            return;
        }
        const um = parseFloat(document.getElementById('um-per-pixel').value);
        if (!um || um <= 0) {
            showToast('请输入有效的 µm/像素值', 'warn');
            return;
        }

        try {
            await Api.updateSlide(currentSlideId, { um_per_pixel: um });
            if (currentSlide) currentSlide.um_per_pixel = um;

            await Api.recalculateMeasurements(currentSlideId);
            await loadAnnotations(currentSlideId);

            document.getElementById('slide-status').textContent = `标定: ${um} µm/px`;
        } catch (err) {}
    });
}

function setupDeconv() {
    document.querySelectorAll('.deconv-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.deconv-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setChannel(btn.dataset.channel);
        });
    });
    document.querySelector('.deconv-btn[data-channel="normal"]').classList.add('active');
}

function setupLayers() {
    document.getElementById('add-layer-btn').addEventListener('click', () => {
        const select = document.getElementById('layer-select');
        const opt = document.createElement('option');
        opt.value = layerCount;
        opt.textContent = `图层 ${layerCount}`;
        select.appendChild(opt);
        select.value = layerCount;
        layerCount++;
        showToast(`已添加图层 ${layerCount - 1}`, 'success');
    });
}
