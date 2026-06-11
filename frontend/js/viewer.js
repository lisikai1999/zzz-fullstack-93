let viewer = null;
let currentSlide = null;
let currentChannel = 'normal';

function initViewer(slide) {
    currentSlide = slide;
    const maxLevel = Math.ceil(Math.log2(Math.max(slide.width, slide.height)));

    if (viewer) {
        viewer.destroy();
    }

    viewer = OpenSeadragon({
        id: 'osd-viewer',
        prefixUrl: 'https://cdn.jsdelivr.net/npm/openseadragon@4.1.1/build/openseadragon/images/',
        tileSources: {
            height: slide.height,
            width: slide.width,
            tileSize: slide.tile_size || 256,
            tileOverlap: slide.overlap || 1,
            maxLevel: maxLevel,
            minLevel: 0,
            getTileUrl: function(level, x, y) {
                if (currentChannel !== 'normal') {
                    return Api.getDeconvTileUrl(slide.id, currentChannel, level, x, y);
                }
                return Api.getTileUrl(slide.id, level, x, y);
            },
        },
        showNavigator: true,
        navigatorPosition: 'BOTTOM_RIGHT',
        immediateRender: true,
        imageLoaderLimit: 6,
        maxImageCacheCount: 300,
        animationTime: 0.3,
        minZoomImageRatio: 0.5,
        maxZoomPixelRatio: 4,
        visibilityRatio: 0.5,
    });

    viewer.addHandler('open', () => {
        resizeAnnotationCanvas();
        renderAllAnnotations();
    });

    viewer.addHandler('animation', () => {
        renderAllAnnotations();
    });

    viewer.addHandler('resize', () => {
        resizeAnnotationCanvas();
        renderAllAnnotations();
    });

    return viewer;
}

function resizeAnnotationCanvas() {
    const canvas = document.getElementById('annotation-canvas');
    const container = document.getElementById('viewer-container');
    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = container.clientHeight;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function setChannel(channel) {
    currentChannel = channel;
    if (viewer) {
        viewer.world.getItemAt(0).source.getTileUrl = function(level, x, y) {
            if (channel !== 'normal') {
                return Api.getDeconvTileUrl(currentSlide.id, channel, level, x, y);
            }
            return Api.getTileUrl(currentSlide.id, level, x, y);
        };
        viewer.world.getItemAt(0).reset();
        viewer.forceRedraw();
    }
}

function imageToCanvas(x, y) {
    if (!viewer) return { x: 0, y: 0 };
    const vp = viewer.viewport.imageToViewerElementCoordinates(new OpenSeadragon.Point(x, y));
    return { x: vp.x, y: vp.y };
}

function canvasToImage(canvasX, canvasY) {
    if (!viewer) return { x: 0, y: 0 };
    const vp = viewer.viewport.viewerElementToImageCoordinates(
        new OpenSeadragon.Point(canvasX, canvasY)
    );
    return { x: Math.round(vp.x), y: Math.round(vp.y) };
}

function getViewportBoundsImage() {
    if (!viewer) return null;
    const bounds = viewer.viewport.getBounds(true);
    const topLeft = viewer.viewport.viewportToImageCoordinates(bounds.x, bounds.y);
    const bottomRight = viewer.viewport.viewportToImageCoordinates(
        bounds.x + bounds.width, bounds.y + bounds.height
    );
    return {
        x: Math.round(topLeft.x),
        y: Math.round(topLeft.y),
        width: Math.round(bottomRight.x - topLeft.x),
        height: Math.round(bottomRight.y - topLeft.y),
    };
}
