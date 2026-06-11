const API_BASE = '/api/v1';

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container') || _createToastContainer();
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('toast-fade');
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

function _createToastContainer() {
    const c = document.createElement('div');
    c.id = 'toast-container';
    document.body.appendChild(c);
    return c;
}

async function _request(url, options = {}) {
    try {
        const res = await fetch(url, options);
        if (!res.ok) {
            let detail = `HTTP ${res.status}`;
            try {
                const body = await res.json();
                detail = body.detail || JSON.stringify(body);
            } catch {}
            throw new Error(detail);
        }
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('application/json')) {
            return await res.json();
        }
        return res;
    } catch (err) {
        if (err.name === 'TypeError' && err.message.includes('fetch')) {
            showToast('网络连接失败，请检查服务是否启动', 'error');
        } else {
            showToast(`请求失败: ${err.message}`, 'error');
        }
        throw err;
    }
}

const Api = {
    async getSlides() {
        return await _request(`${API_BASE}/slides/`);
    },

    async getSlide(id) {
        return await _request(`${API_BASE}/slides/${id}`);
    },

    async uploadSlide(file, displayName, umPerPixel) {
        const form = new FormData();
        form.append('file', file);
        if (displayName) form.append('display_name', displayName);
        if (umPerPixel) form.append('um_per_pixel', umPerPixel);
        const result = await _request(`${API_BASE}/slides/`, { method: 'POST', body: form });
        showToast('切片上传成功，正在处理瓦片...', 'success');
        return result;
    },

    async updateSlide(id, data) {
        return await _request(`${API_BASE}/slides/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },

    async deleteSlide(id) {
        await _request(`${API_BASE}/slides/${id}`, { method: 'DELETE' });
    },

    getTileUrl(slideId, level, col, row) {
        return `${API_BASE}/tiles/${slideId}/${level}/${col}_${row}.jpeg`;
    },

    getDeconvTileUrl(slideId, channel, level, col, row) {
        return `${API_BASE}/analysis/${slideId}/color-deconv/${channel}/${level}/${col}_${row}.jpeg`;
    },

    async getAnnotations(slideId, layer) {
        let url = `${API_BASE}/annotations/?slide_id=${slideId}`;
        if (layer !== undefined && layer !== null) url += `&layer=${layer}`;
        return await _request(url);
    },

    async createAnnotation(data) {
        return await _request(`${API_BASE}/annotations/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },

    async updateAnnotation(id, data) {
        return await _request(`${API_BASE}/annotations/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
    },

    async deleteAnnotation(id) {
        await _request(`${API_BASE}/annotations/${id}`, { method: 'DELETE' });
    },

    async recalculateMeasurements(slideId) {
        const result = await _request(`${API_BASE}/annotations/recalculate/${slideId}`, { method: 'POST' });
        showToast(`已重算 ${result.updated} 条标注的测量值`, 'success');
        return result;
    },

    async compareAnnotations(aId, bId) {
        return await _request(`${API_BASE}/annotations/compare`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ annotation_a_id: aId, annotation_b_id: bId }),
        });
    },

    async getNuclearRatio(slideId, roi) {
        return await _request(`${API_BASE}/analysis/${slideId}/nuclear-ratio`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ roi }),
        });
    },
};
