let currentTool = 'pan';
let drawingState = 'idle';
let currentPoints = [];
let annotations = [];
let selectedAnnotation = null;

// Edit state
let editMode = null; // 'vertex' | 'move'
let editingVertex = null; // { annIdx, vertexIdx }
let moveState = null; // { annIdx, startImage, origCoords }

function setTool(tool) {
    currentTool = tool;
    drawingState = 'idle';
    currentPoints = [];
    editMode = null;
    editingVertex = null;
    moveState = null;

    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    const canvas = document.getElementById('annotation-canvas');
    if (tool === 'pan') {
        canvas.classList.remove('drawing');
        if (viewer) viewer.setMouseNavEnabled(true);
    } else {
        canvas.classList.add('drawing');
        if (viewer) viewer.setMouseNavEnabled(false);
    }
}

function initAnnotationEvents() {
    const canvas = document.getElementById('annotation-canvas');

    canvas.addEventListener('mousedown', (e) => {
        if (currentTool === 'pan') return;

        if (currentTool === 'edit') {
            handleEditMouseDown(e);
            return;
        }

        const pt = canvasToImage(e.offsetX, e.offsetY);

        if (currentTool === 'freehand') {
            drawingState = 'drawing';
            currentPoints = [[pt.x, pt.y]];
        } else if (currentTool === 'line') {
            if (drawingState !== 'drawing') {
                drawingState = 'drawing';
                currentPoints = [[pt.x, pt.y]];
            } else {
                currentPoints.push([pt.x, pt.y]);
                finishAnnotation();
            }
        } else if (currentTool === 'polygon') {
            if (drawingState !== 'drawing') {
                drawingState = 'drawing';
                currentPoints = [[pt.x, pt.y]];
            } else {
                if (currentPoints.length >= 3 && distPx(e.offsetX, e.offsetY, currentPoints[0]) < 15) {
                    finishAnnotation();
                } else {
                    currentPoints.push([pt.x, pt.y]);
                }
            }
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (currentTool === 'edit') {
            if (editMode === 'vertex' && editingVertex) {
                const pt = canvasToImage(e.offsetX, e.offsetY);
                annotations[editingVertex.annIdx].geometry.coordinates[editingVertex.vertexIdx] = [pt.x, pt.y];
                renderAllAnnotations(e.offsetX, e.offsetY);
                return;
            }
            if (editMode === 'move' && moveState) {
                const pt = canvasToImage(e.offsetX, e.offsetY);
                const dx = pt.x - moveState.startImage.x;
                const dy = pt.y - moveState.startImage.y;
                const ann = annotations[moveState.annIdx];
                ann.geometry.coordinates = moveState.origCoords.map(c => [c[0] + dx, c[1] + dy]);
                renderAllAnnotations(e.offsetX, e.offsetY);
                return;
            }
            // Update cursor based on what's under pointer
            updateEditCursor(e);
            renderAllAnnotations(e.offsetX, e.offsetY);
            return;
        }

        if (currentTool === 'freehand' && drawingState === 'drawing') {
            const pt = canvasToImage(e.offsetX, e.offsetY);
            const last = currentPoints[currentPoints.length - 1];
            const dx = pt.x - last[0];
            const dy = pt.y - last[1];
            if (dx * dx + dy * dy > 9) {
                currentPoints.push([pt.x, pt.y]);
            }
        }
        renderAllAnnotations(e.offsetX, e.offsetY);
    });

    canvas.addEventListener('mouseup', (e) => {
        if (currentTool === 'edit') {
            if (editMode === 'vertex' || editMode === 'move') {
                commitEdit();
            }
            return;
        }

        if (currentTool === 'freehand' && drawingState === 'drawing') {
            if (currentPoints.length >= 3) {
                currentPoints = simplifyPath(currentPoints, 2);
                finishAnnotation();
            } else {
                drawingState = 'idle';
                currentPoints = [];
            }
        }
    });

    canvas.addEventListener('dblclick', () => {
        if (currentTool === 'polygon' && drawingState === 'drawing' && currentPoints.length >= 3) {
            finishAnnotation();
        }
    });

    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (drawingState === 'drawing') {
            drawingState = 'idle';
            currentPoints = [];
            renderAllAnnotations();
        }
    });
}

// ─── Edit mode: vertex drag + whole shape move ────────────────────────────────

function handleEditMouseDown(e) {
    const VERTEX_HIT = 8;
    const showAll = document.getElementById('show-all-layers').checked;
    const activeLayer = parseInt(document.getElementById('layer-select').value);

    // First pass: check vertex hits (higher priority)
    for (let i = 0; i < annotations.length; i++) {
        const ann = annotations[i];
        if (!showAll && ann.layer !== activeLayer) continue;
        const coords = ann.geometry.coordinates;
        if (!coords) continue;

        for (let v = 0; v < coords.length; v++) {
            const cp = imageToCanvas(coords[v][0], coords[v][1]);
            const dx = e.offsetX - cp.x;
            const dy = e.offsetY - cp.y;
            if (Math.sqrt(dx * dx + dy * dy) < VERTEX_HIT) {
                editMode = 'vertex';
                editingVertex = { annIdx: i, vertexIdx: v };
                selectedAnnotation = annotations[i];
                updateAnnotationList();
                renderAllAnnotations();
                return;
            }
        }
    }

    // Second pass: check if click is inside any polygon (for move)
    const clickImg = canvasToImage(e.offsetX, e.offsetY);
    for (let i = 0; i < annotations.length; i++) {
        const ann = annotations[i];
        if (!showAll && ann.layer !== activeLayer) continue;
        const coords = ann.geometry.coordinates;
        if (!coords || coords.length < 3) continue;
        if (ann.tool_type === 'line') continue;

        if (pointInPolygon(clickImg.x, clickImg.y, coords)) {
            editMode = 'move';
            moveState = {
                annIdx: i,
                startImage: { x: clickImg.x, y: clickImg.y },
                origCoords: coords.map(c => [c[0], c[1]]),
            };
            selectedAnnotation = annotations[i];
            updateAnnotationList();
            renderAllAnnotations();
            return;
        }
    }

    // Clicked nothing
    editMode = null;
    editingVertex = null;
    moveState = null;
}

function updateEditCursor(e) {
    const canvas = document.getElementById('annotation-canvas');
    const VERTEX_HIT = 8;
    const showAll = document.getElementById('show-all-layers').checked;
    const activeLayer = parseInt(document.getElementById('layer-select').value);

    // Check vertex
    for (const ann of annotations) {
        if (!showAll && ann.layer !== activeLayer) continue;
        const coords = ann.geometry.coordinates;
        if (!coords) continue;
        for (const c of coords) {
            const cp = imageToCanvas(c[0], c[1]);
            const dx = e.offsetX - cp.x;
            const dy = e.offsetY - cp.y;
            if (Math.sqrt(dx * dx + dy * dy) < VERTEX_HIT) {
                canvas.style.cursor = 'grab';
                return;
            }
        }
    }

    // Check inside polygon
    const clickImg = canvasToImage(e.offsetX, e.offsetY);
    for (const ann of annotations) {
        if (!showAll && ann.layer !== activeLayer) continue;
        if (ann.tool_type === 'line') continue;
        const coords = ann.geometry.coordinates;
        if (!coords || coords.length < 3) continue;
        if (pointInPolygon(clickImg.x, clickImg.y, coords)) {
            canvas.style.cursor = 'move';
            return;
        }
    }

    canvas.style.cursor = 'crosshair';
}

async function commitEdit() {
    const annIdx = editMode === 'vertex' ? editingVertex?.annIdx : moveState?.annIdx;
    editMode = null;
    editingVertex = null;
    moveState = null;

    if (annIdx == null) return;
    const ann = annotations[annIdx];

    try {
        const result = await Api.updateAnnotation(ann.id, {
            slide_id: ann.slide_id,
            annotator: ann.annotator,
            label: ann.label,
            tool_type: ann.tool_type,
            geometry: ann.geometry,
            layer: ann.layer,
            color: ann.color,
        });
        annotations[annIdx] = result;
        selectedAnnotation = result;
        if (result.measurement) {
            Measurements.formatDisplay(result.measurement, result.tool_type);
        }
        updateAnnotationList();
        renderAllAnnotations();
    } catch (err) {}
}

function pointInPolygon(px, py, coords) {
    let inside = false;
    const n = coords.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = coords[i][0], yi = coords[i][1];
        const xj = coords[j][0], yj = coords[j][1];
        if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
            inside = !inside;
        }
    }
    return inside;
}

// ─── Drawing finish ───────────────────────────────────────────────────────────

function distPx(canvasX, canvasY, imagePoint) {
    const cp = imageToCanvas(imagePoint[0], imagePoint[1]);
    const dx = canvasX - cp.x;
    const dy = canvasY - cp.y;
    return Math.sqrt(dx * dx + dy * dy);
}

async function finishAnnotation() {
    drawingState = 'idle';

    const geometry = { type: currentTool === 'line' ? 'LineString' : 'Polygon', coordinates: currentPoints };
    const layer = parseInt(document.getElementById('layer-select').value);
    const annotator = document.getElementById('annotator-input').value || '匿名';

    const data = {
        slide_id: currentSlide.id,
        annotator: annotator,
        label: currentTool === 'line' ? '距离测量' : '肿瘤区域',
        tool_type: currentTool,
        geometry: geometry,
        layer: layer,
        color: getLayerColor(layer),
    };

    try {
        const result = await Api.createAnnotation(data);
        annotations.push(result);
        currentPoints = [];

        if (result.measurement) {
            Measurements.formatDisplay(result.measurement, currentTool);
        }

        updateAnnotationList();
        updateCompareSelects();
        renderAllAnnotations();
    } catch (err) {
        currentPoints = [];
        renderAllAnnotations();
    }
}

// ─── Render ───────────────────────────────────────────────────────────────────

function renderAllAnnotations(mouseX, mouseY) {
    const canvas = document.getElementById('annotation-canvas');
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    const showAll = document.getElementById('show-all-layers').checked;
    const activeLayer = parseInt(document.getElementById('layer-select').value);

    for (const ann of annotations) {
        if (!showAll && ann.layer !== activeLayer) continue;
        drawAnnotation(ctx, ann, ann === selectedAnnotation);
    }

    if (drawingState === 'drawing' && currentPoints.length > 0) {
        drawCurrentPath(ctx, mouseX, mouseY);
    }
}

function drawAnnotation(ctx, ann, isSelected) {
    const coords = ann.geometry.coordinates;
    if (!coords || coords.length === 0) return;

    ctx.beginPath();
    const first = imageToCanvas(coords[0][0], coords[0][1]);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < coords.length; i++) {
        const p = imageToCanvas(coords[i][0], coords[i][1]);
        ctx.lineTo(p.x, p.y);
    }

    if (ann.tool_type !== 'line') {
        ctx.closePath();
        ctx.fillStyle = hexToRgba(ann.color, 0.15);
        ctx.fill();
    }

    ctx.strokeStyle = ann.color;
    ctx.lineWidth = isSelected ? 3 : 1.5;
    ctx.stroke();

    // Draw vertex handles in edit mode for selected annotation
    if (currentTool === 'edit' && isSelected) {
        for (let i = 0; i < coords.length; i++) {
            const p = imageToCanvas(coords[i][0], coords[i][1]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = ann.color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }
    }

    if (ann.tool_type === 'line' && coords.length === 2) {
        const mid = imageToCanvas(
            (coords[0][0] + coords[1][0]) / 2,
            (coords[0][1] + coords[1][1]) / 2
        );
        if (ann.measurement && ann.measurement.length_um != null) {
            ctx.font = '12px sans-serif';
            ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 2;
            const text = `${ann.measurement.length_um.toFixed(1)} µm`;
            ctx.strokeText(text, mid.x + 5, mid.y - 5);
            ctx.fillText(text, mid.x + 5, mid.y - 5);
        }
    }
}

function drawCurrentPath(ctx, mouseX, mouseY) {
    if (currentPoints.length === 0) return;

    ctx.beginPath();
    const first = imageToCanvas(currentPoints[0][0], currentPoints[0][1]);
    ctx.moveTo(first.x, first.y);

    for (let i = 1; i < currentPoints.length; i++) {
        const p = imageToCanvas(currentPoints[i][0], currentPoints[i][1]);
        ctx.lineTo(p.x, p.y);
    }

    if ((currentTool === 'line' || currentTool === 'polygon') && mouseX !== undefined) {
        ctx.lineTo(mouseX, mouseY);
    }

    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (currentTool === 'polygon' && currentPoints.length >= 3) {
        const fp = imageToCanvas(currentPoints[0][0], currentPoints[0][1]);
        ctx.beginPath();
        ctx.arc(fp.x, fp.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,0,0.5)';
        ctx.fill();
    }
}

// ─── Annotation list / Compare ────────────────────────────────────────────────

function updateAnnotationList() {
    const list = document.getElementById('annotation-list');
    list.innerHTML = '';

    for (const ann of annotations) {
        const item = document.createElement('div');
        item.className = 'ann-item' + (ann === selectedAnnotation ? ' selected' : '');
        item.innerHTML = `
            <span class="color-dot" style="background:${ann.color}"></span>
            <span class="ann-info">${ann.annotator} - ${ann.label} (L${ann.layer})</span>
            <span class="ann-delete" data-id="${ann.id}">&times;</span>
        `;
        item.addEventListener('click', (e) => {
            if (e.target.classList.contains('ann-delete')) return;
            selectedAnnotation = ann;
            if (ann.measurement) {
                Measurements.formatDisplay(ann.measurement, ann.tool_type);
            }
            updateAnnotationList();
            renderAllAnnotations();
        });
        item.querySelector('.ann-delete').addEventListener('click', async () => {
            try {
                await Api.deleteAnnotation(ann.id);
                annotations = annotations.filter(a => a.id !== ann.id);
                if (selectedAnnotation === ann) selectedAnnotation = null;
                updateAnnotationList();
                updateCompareSelects();
                renderAllAnnotations();
                showToast('标注已删除', 'success');
            } catch (err) {}
        });
        list.appendChild(item);
    }
}

function updateCompareSelects() {
    const selA = document.getElementById('compare-a');
    const selB = document.getElementById('compare-b');
    const polyAnns = annotations.filter(a => a.tool_type !== 'line');

    [selA, selB].forEach(sel => {
        sel.innerHTML = '';
        polyAnns.forEach(ann => {
            const opt = document.createElement('option');
            opt.value = ann.id;
            opt.textContent = `#${ann.id} ${ann.annotator} (L${ann.layer})`;
            sel.appendChild(opt);
        });
    });
}

async function loadAnnotations(slideId) {
    try {
        annotations = await Api.getAnnotations(slideId);
    } catch (err) {
        annotations = [];
    }
    selectedAnnotation = null;
    updateAnnotationList();
    updateCompareSelects();
    renderAllAnnotations();
}

function getLayerColor(layer) {
    const colors = ['#ff4444', '#44ff44', '#4444ff', '#ffff44', '#ff44ff', '#44ffff',
                    '#ff8844', '#44ff88', '#8844ff', '#88ff44', '#ff4488', '#4488ff'];
    return colors[layer % colors.length];
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function simplifyPath(points, epsilon) {
    if (points.length <= 2) return points;

    let maxDist = 0;
    let maxIdx = 0;
    const first = points[0];
    const last = points[points.length - 1];

    for (let i = 1; i < points.length - 1; i++) {
        const d = perpendicularDist(points[i], first, last);
        if (d > maxDist) {
            maxDist = d;
            maxIdx = i;
        }
    }

    if (maxDist > epsilon) {
        const left = simplifyPath(points.slice(0, maxIdx + 1), epsilon);
        const right = simplifyPath(points.slice(maxIdx), epsilon);
        return left.slice(0, -1).concat(right);
    }

    return [first, last];
}

function perpendicularDist(point, lineStart, lineEnd) {
    const dx = lineEnd[0] - lineStart[0];
    const dy = lineEnd[1] - lineStart[1];
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return Math.sqrt((point[0] - lineStart[0]) ** 2 + (point[1] - lineStart[1]) ** 2);
    const t = ((point[0] - lineStart[0]) * dx + (point[1] - lineStart[1]) * dy) / (len * len);
    const projX = lineStart[0] + t * dx;
    const projY = lineStart[1] + t * dy;
    return Math.sqrt((point[0] - projX) ** 2 + (point[1] - projY) ** 2);
}
