let map = L.map('map', {
    maxZoom: 22
}).setView([-7.0, 110.0], 10);

L.tileLayer('https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', {
    attribution: 'Google Satellite',
    maxZoom: 22
}).addTo(map);

let placemarks = [];
let polygons = [];
let basePlacemark = null;
let selectedTargets = [];
let selectedPolygons = []; // polygons user selected to be COVERAGE before generate
let mode = null;
let drawControl;
let baseGroups = []; // generated path groups (DW)
let targetHC = false; // target homepass
// Files management
let filesData = []; // { id, name, visible }
// FAT bases selected when generatePaths runs: { 'Line A': { 'BaseName': {name, lat, lon, fileId, fileName} } }
let fatBases = {};

const kmlInputEl = document.getElementById('kmlInput');
kmlInputEl.addEventListener('change', handleKMLUpload);
kmlInputEl.setAttribute('multiple', 'true');

function handleKMLUpload(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;
    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const kmlText = e.target.result;
            const parser = new DOMParser();
            const kmlDoc = parser.parseFromString(kmlText, "text/xml");
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2,6);
            filesData.push({ id, name: file.name, visible: true });
            // update file name indicator (show last loaded file)
            // document.getElementById('fileName').textContent = file.name;
            parseKML(kmlDoc, id, file.name);
            renderSidebarFiles();
            renderFileList();
        };
        reader.readAsText(file);
    });
    // clear input so same file can be re-opened later if needed
    kmlInputEl.value = '';
}
const checkbox = document.getElementById('checkbox-hp');
checkbox.addEventListener('change', function () {
    if (checkbox.checked) {
        targetHC = true;
        defaultIconClr = 'green';
        // Tambahkan aksi lain di sini, misalnya tampilkan elemen:
        // document.getElementById('target-element').style.display = 'block';
    } else {
        targetHC = false;
        defaultIconClr = 'blue';
        // document.getElementById('target-element').style.display = 'none';
    }
});
function parseKML(kmlDoc, fileId, fileName) {
    const placemarkElements = kmlDoc.getElementsByTagName("Placemark");
    for (let el of placemarkElements) {
        const name = el.getElementsByTagName("name")[0]?.textContent || "Unnamed";
        const coordsEl = el.getElementsByTagName("coordinates")[0];
        if (!coordsEl) continue;

        const coordsText = coordsEl.textContent.trim();
        const coordPairs = coordsText.split(/\s+/);
        if (coordPairs.length === 1) {
            const [lon, lat] = coordPairs[0].split(",").map(Number);
            if (targetHC) {
                defaultIconClr = 'green';
            };
        const { marker, label } = addLabeledMarker(name, lat, lon);
        marker.on('click', (e) => handleClick(e.originalEvent, marker, name, lat, lon));
        placemarks.push({ name, lat, lon, marker, label, visible: true, fileId, fileName, target: targetHC });
        } else {
            const latlngs = coordPairs.map(pair => {
            const [lon, lat] = pair.split(",").map(Number);
            return [lat, lon];
        });
        const polygon = L.polygon(latlngs, { color: 'green', fillOpacity: 0.3 }).addTo(map);//.bindPopup(name);
        polygon.on('click', () => handlePolygonClick(polygon));
         polygons.push({ name, polygon, visible: true, fileId, fileName });
        }
    }

    // no per-feature sidebar now; files list updated separately
}
// Render left panel 'Folder' as list of files only
function renderSidebarFiles() {
    const baseList = document.getElementById('fileLayerList');
    baseList.innerHTML = '';
    filesData.forEach((f, idx) => {
        const li = document.createElement('li');
        li.className = 'group-item';
        li.innerHTML = `
            <div class="group-header">
                <div class="group-name"><label class="checkbox-file"><input type="checkbox" data-fileid="${f.id}" ${f.visible? 'checked':''}> ${escapeHTML(f.name)}</label></div>
                <div class="group-actions"><button data-action="delete" data-fileid="${f.id}" title="Hapus file">🗑️</button></div>
            </div>`;
        baseList.appendChild(li);
    });

        // attach events
    baseList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', (e) => {
            const fid = e.target.getAttribute('data-fileid');
            const file = filesData.find(x => x.id === fid);
            if (!file) return;
            file.visible = e.target.checked;
            // toggle features belonging to file
            placemarks.forEach(p => {
                if (p.fileId === fid) {
                    p.visible = file.visible;
                    if (file.visible) { map.addLayer(p.marker); if (p.label) map.addLayer(p.label); } else { try{ map.removeLayer(p.marker); if (p.label) map.removeLayer(p.label); }catch(e){} }
                }
            });
            polygons.forEach(poly => {
                if (poly.fileId === fid) {
                    poly.visible = file.visible;
                    if (file.visible) map.addLayer(poly.polygon); else try{ map.removeLayer(poly.polygon); }catch(e){}
                }
            });
            // rebuild DW polylines to reflect file visibility
            rebuildDWPolylines();
        });
    });

    baseList.querySelectorAll('button[data-action="delete"]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const fid = e.target.getAttribute('data-fileid');
            deleteFileById(fid);
        });
    });
}
function renderSidebarBases() {
        const baseList = document.getElementById('fileLayerList');
        baseList.innerHTML = '';

        // Placemarks (points)
        const pointsHeader = document.createElement('li');
        pointsHeader.innerHTML = '<strong>Points</strong>';
        baseList.appendChild(pointsHeader);

        placemarks.forEach((p, idx) => {
          const li = document.createElement('li');
          const id = `base-p-${idx}`;
          li.innerHTML = `
            <label class="checkbox-file"><input type="checkbox" id="${id}" data-type="point" data-idx="${idx}" checked> ${escapeHTML(p.name)}</label>`;
          baseList.appendChild(li);
          document.getElementById(id).addEventListener('change', (e) => {
            p.visible = e.target.checked;
            if (p.marker) {
              if (p.visible) {
                map.addLayer(p.marker);
                if (p.label) map.addLayer(p.label);
              } else {
                map.removeLayer(p.marker);
                if (p.label) map.removeLayer(p.label);
              }
            }
          });
        });

        // Polygons
        const polyHeader = document.createElement('li');
        polyHeader.innerHTML = '<strong>Polygons</strong>';
        baseList.appendChild(polyHeader);
        polygons.forEach((poly, idx) => {
          const li = document.createElement('li');
          const id = `base-poly-${idx}`;
          li.innerHTML = `
            <label class="checkbox-file"><input type="checkbox" id="${id}" data-type="poly" data-idx="${idx}" checked> ${escapeHTML(poly.name)}</label>`;
          baseList.appendChild(li);
          document.getElementById(id).addEventListener('change', (e) => {
            poly.visible = e.target.checked;
            if (poly.polygon) {
              if (poly.visible) map.addLayer(poly.polygon); else map.removeLayer(poly.polygon);
            }
          });
        });
      }

      function escapeHTML(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

      function renderFileList() {
        const list = document.getElementById('baseGroupList');
        list.innerHTML = '';

        function getLine(baseName) {
          const n = (baseName || '').toLowerCase();
          if (n.indexOf('a') !== -1) return 'LINE A';
          if (n.indexOf('b') !== -1) return 'LINE B';
          if (n.indexOf('c') !== -1) return 'LINE C';
          if (n.indexOf('d') !== -1) return 'LINE D';
          if (n.indexOf('e') !== -1) return 'LINE E';
          if (n.indexOf('f') !== -1) return 'LINE F';
          return null; // do not include Line Other
        }

        // Only populate file list from generated baseGroups
        if (!baseGroups || baseGroups.length === 0) {
          const info = document.createElement('li');
          info.textContent = 'Belum ada jalur yang dihasilkan. Tekan "Runing" setelah memilih base dan target.';
          list.appendChild(info);
          return;
        }

        // Build structure per line with subfolders: HP, FAT, COVERAGE, DW
        const lines = {};

        // HP and DW come from baseGroups
        baseGroups.forEach(group => {
          const line = getLine(group.base.name);
          if (!line) return; // skip bases that are not Line A/B
          lines[line] = lines[line] || { hp: {}, fat: {}, cov: {}, dw: {} };
          const baseName = group.base.name;
          lines[line].hp[baseName] = lines[line].hp[baseName] || [];
          // add targets to HP listing (as points under base)
          group.targets.forEach(t => lines[line].hp[baseName].push(t));
          // add to DW listing: group may have multiple targets; keep groups per base
          lines[line].dw[baseName] = lines[line].dw[baseName] || [];
          lines[line].dw[baseName].push(...group.targets);
        });

        // FAT: collect placemarks whose name indicates FAT/ODC
        // FAT: use fatBases captured when generatePaths ran
        Object.keys(fatBases).forEach(line => {
          lines[line] = lines[line] || { hp: {}, fat: {}, cov: {}, dw: {} };
          Object.keys(fatBases[line] || {}).forEach(baseName => {
            const p = fatBases[line][baseName];
            lines[line].fat[baseName] = lines[line].fat[baseName] || [];
            lines[line].fat[baseName].push(p);
          });
        });

        // COVERAGE: use polygons that were explicitly selected before generatePaths.
        // The selected polygons are stored per base in baseGroups[].coverages when user pressed "Jalankan".
        baseGroups.forEach(group => {
          const line = getLine(group.base.name);
          if (!line) return;
          lines[line] = lines[line] || { hp: {}, fat: {}, cov: {}, dw: {} };
          const baseName = group.base.name;
          lines[line].cov[baseName] = lines[line].cov[baseName] || [];
          (group.coverages || []).forEach(cov => {
            // cov is { name, polygon, fileId, fileName }
            lines[line].cov[baseName].push(cov);
          });
        });

        Object.keys(lines).forEach(line => {
          const liLine = document.createElement('li');

          // line header with toggle
          const lineHeaderWrap = document.createElement('div');
          lineHeaderWrap.className = 'tree-header';
          const lineToggle = document.createElement('span');
          lineToggle.className = 'toggle';
          lineToggle.textContent = '▶';
          const lineLabel = document.createElement('span');
          lineLabel.className = 'node-label';
          lineLabel.textContent = line;
          lineLabel.style.fontWeight = 'bold';
          lineHeaderWrap.appendChild(lineToggle);
          lineHeaderWrap.appendChild(lineLabel);
          liLine.appendChild(lineHeaderWrap);

          const lineChildren = document.createElement('ul');
          lineChildren.className = 'tree-children';
          lineChildren.style.display = 'none';
          function toggleLine() { const isOpen = lineToggle.classList.contains('open'); if (isOpen) { lineChildren.style.display='none'; lineToggle.classList.remove('open'); } else { lineChildren.style.display='block'; lineToggle.classList.add('open'); } }
          lineToggle.addEventListener('click', (e) => { e.stopPropagation(); toggleLine(); });
          lineLabel.addEventListener('click', (e) => { e.stopPropagation(); toggleLine(); });

          // HP node
          const hpLi = document.createElement('li');
          const hpWrap = document.createElement('div'); hpWrap.className='tree-header';
          const hpToggle = document.createElement('span'); hpToggle.className='toggle'; hpToggle.textContent='▶';
          const hpLabel = document.createElement('span'); hpLabel.className='node-label'; hpLabel.textContent='HP'; hpLabel.style.fontStyle='italic';
          hpWrap.appendChild(hpToggle); hpWrap.appendChild(hpLabel); hpLi.appendChild(hpWrap);
          const hpChildren = document.createElement('ul'); hpChildren.className='tree-children'; hpChildren.style.display='none';
          hpToggle.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=hpToggle.classList.contains('open'); if(isOpen){ hpChildren.style.display='none'; hpToggle.classList.remove('open'); } else { hpChildren.style.display='block'; hpToggle.classList.add('open'); }});
          hpLabel.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=hpToggle.classList.contains('open'); if(isOpen){ hpChildren.style.display='none'; hpToggle.classList.remove('open'); } else { hpChildren.style.display='block'; hpToggle.classList.add('open'); }});

          // populate HP entries for this line
          const lineObj = lines[line];
          Object.keys(lineObj.hp || {}).forEach(baseName => {
            const baseLi = document.createElement('li');
            const baseWrap = document.createElement('div'); baseWrap.className='tree-header';
            const baseToggle = document.createElement('span'); baseToggle.className='toggle'; baseToggle.textContent='▶';
            const baseLabel = document.createElement('span'); baseLabel.className='node-label'; baseLabel.textContent=baseName; baseLabel.style.fontWeight='600';
            baseWrap.appendChild(baseToggle); baseWrap.appendChild(baseLabel); baseLi.appendChild(baseWrap);
            const baseChildren = document.createElement('ul'); baseChildren.className='tree-children'; baseChildren.style.display='none';
            baseToggle.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=baseToggle.classList.contains('open'); if(isOpen){ baseChildren.style.display='none'; baseToggle.classList.remove('open'); } else { baseChildren.style.display='block'; baseToggle.classList.add('open'); }});
            baseLabel.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=baseToggle.classList.contains('open'); if(isOpen){ baseChildren.style.display='none'; baseToggle.classList.remove('open'); } else { baseChildren.style.display='block'; baseToggle.classList.add('open'); }});
            (lineObj.hp[baseName]||[]).forEach(t=>{
              const item = document.createElement('li'); item.textContent = t.name; item.style.cursor='pointer'; item.addEventListener('click',(e)=>{ e.stopPropagation(); try{ map.setView([t.lat,t.lon],18);}catch(err){} }); baseChildren.appendChild(item);
            });
            baseLi.appendChild(baseChildren); hpChildren.appendChild(baseLi);
          });

          hpLi.appendChild(hpChildren);
          lineChildren.appendChild(hpLi);

          // FAT node
          const fatLi = document.createElement('li');
          const fatWrap = document.createElement('div'); fatWrap.className='tree-header';
          const fatToggle = document.createElement('span'); fatToggle.className='toggle'; fatToggle.textContent='▶';
          const fatLabel = document.createElement('span'); fatLabel.className='node-label'; fatLabel.textContent='FAT'; fatLabel.style.fontStyle='italic';
          fatWrap.appendChild(fatToggle); fatWrap.appendChild(fatLabel); fatLi.appendChild(fatWrap);
          const fatChildren = document.createElement('ul'); fatChildren.className='tree-children'; fatChildren.style.display='none';
          fatToggle.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=fatToggle.classList.contains('open'); if(isOpen){ fatChildren.style.display='none'; fatToggle.classList.remove('open'); } else { fatChildren.style.display='block'; fatToggle.classList.add('open'); }});
          fatLabel.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=fatToggle.classList.contains('open'); if(isOpen){ fatChildren.style.display='none'; fatToggle.classList.remove('open'); } else { fatChildren.style.display='block'; fatToggle.classList.add('open'); }});
          // FAT: tampilkan langsung nama point base (flat list) tanpa subfolder
          Object.keys(lineObj.fat || {}).forEach(baseName => {
            (lineObj.fat[baseName]||[]).forEach(p => {
              const item = document.createElement('li');
              item.textContent = p.name || baseName;
              item.style.cursor = 'pointer';
              item.addEventListener('click', () => { try { map.setView([p.lat, p.lon], 18); } catch (e) {} });
              fatChildren.appendChild(item);
            });
          });
          fatLi.appendChild(fatChildren); lineChildren.appendChild(fatLi);

          // COVERAGE node
          const covLi = document.createElement('li');
          const covWrap = document.createElement('div'); covWrap.className='tree-header';
          const covToggle = document.createElement('span'); covToggle.className='toggle'; covToggle.textContent='▶';
          const covLabel = document.createElement('span'); covLabel.className='node-label'; covLabel.textContent='COVERAGE'; covLabel.style.fontStyle='italic';
          covWrap.appendChild(covToggle); covWrap.appendChild(covLabel); covLi.appendChild(covWrap);
          const covChildren = document.createElement('ul'); covChildren.className='tree-children'; covChildren.style.display='none';
          covToggle.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=covToggle.classList.contains('open'); if(isOpen){ covChildren.style.display='none'; covToggle.classList.remove('open'); } else { covChildren.style.display='block'; covToggle.classList.add('open'); }});
          covLabel.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=covToggle.classList.contains('open'); if(isOpen){ covChildren.style.display='none'; covToggle.classList.remove('open'); } else { covChildren.style.display='block'; covToggle.classList.add('open'); }});
          // COVERAGE: tampilkan langsung nama basepoint (flat list). Setiap item mewakili polygon yang dipilih saat generate.
          Object.keys(lineObj.cov || {}).forEach(baseName => {
            (lineObj.cov[baseName]||[]).forEach(poly => {
              const item = document.createElement('li');
              const displayName = baseName || (poly.name || 'COVERAGE');
              item.textContent = displayName;
              item.style.cursor = 'pointer';
              item.addEventListener('click', () => { try { map.fitBounds(poly.polygon.getBounds()); } catch (e) {} });
              covChildren.appendChild(item);
            });
          });
          covLi.appendChild(covChildren); lineChildren.appendChild(covLi);

          // DW node
          const dwLi = document.createElement('li');
          const dwWrap = document.createElement('div'); dwWrap.className='tree-header';
          const dwToggle = document.createElement('span'); dwToggle.className='toggle'; dwToggle.textContent='▶';
          const dwLabel = document.createElement('span'); dwLabel.className='node-label'; dwLabel.textContent='DW'; dwLabel.style.fontStyle='italic';
          dwWrap.appendChild(dwToggle); dwWrap.appendChild(dwLabel); dwLi.appendChild(dwWrap);
          const dwChildren = document.createElement('ul'); dwChildren.className='tree-children'; dwChildren.style.display='none';
          dwToggle.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=dwToggle.classList.contains('open'); if(isOpen){ dwChildren.style.display='none'; dwToggle.classList.remove('open'); } else { dwChildren.style.display='block'; dwToggle.classList.add('open'); }});
          dwLabel.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=dwToggle.classList.contains('open'); if(isOpen){ dwChildren.style.display='none'; dwToggle.classList.remove('open'); } else { dwChildren.style.display='block'; dwToggle.classList.add('open'); }});
          Object.keys(lineObj.dw || {}).forEach(baseName => {
            const baseLi = document.createElement('li');
            const baseWrap = document.createElement('div'); baseWrap.className='tree-header';
            const baseToggle = document.createElement('span'); baseToggle.className='toggle'; baseToggle.textContent='▶';
            const baseLabel = document.createElement('span'); baseLabel.className='node-label'; baseLabel.textContent = baseName; baseLabel.style.fontWeight='600';
            baseWrap.appendChild(baseToggle); baseWrap.appendChild(baseLabel); baseLi.appendChild(baseWrap);
            const baseChildren = document.createElement('ul'); baseChildren.className='tree-children'; baseChildren.style.display='none';
            baseToggle.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=baseToggle.classList.contains('open'); if(isOpen){ baseChildren.style.display='none'; baseToggle.classList.remove('open'); } else { baseChildren.style.display='block'; baseToggle.classList.add('open'); }});
            baseLabel.addEventListener('click',(e)=>{ e.stopPropagation(); const isOpen=baseToggle.classList.contains('open'); if(isOpen){ baseChildren.style.display='none'; baseToggle.classList.remove('open'); } else { baseChildren.style.display='block'; baseToggle.classList.add('open'); }});
            (lineObj.dw[baseName]||[]).forEach(t=>{
              const item = document.createElement('li'); item.textContent = `DW: ${t.name}`; item.style.cursor='pointer'; item.addEventListener('click',(e)=>{ e.stopPropagation(); try{ map.fitBounds([[t.lat,t.lon],[/* anchor? */ t.lat,t.lon]]); map.setView([t.lat,t.lon], 14);}catch(err){} }); baseChildren.appendChild(item);
            });
            baseLi.appendChild(baseChildren); dwChildren.appendChild(baseLi);
          });
          dwLi.appendChild(dwChildren); lineChildren.appendChild(dwLi);

          liLine.appendChild(lineChildren);
          list.appendChild(liLine);
        });
      }

      function deleteFileById(fid) {
        // remove from filesData
        filesData = filesData.filter(f => f.id !== fid);

        // remove placemarks and their markers/labels
        placemarks.filter(p => p.fileId === fid).forEach(p => {
          try { map.removeLayer(p.marker); } catch(e) {}
          try { if (p.label) map.removeLayer(p.label); } catch(e) {}
        });
        // remove polygons
        polygons.filter(poly => poly.fileId === fid).forEach(poly => {
          try { map.removeLayer(poly.polygon); } catch(e) {}
        });

        // remove entries from arrays
        placemarks = placemarks.filter(p => p.fileId !== fid);
        polygons = polygons.filter(poly => poly.fileId !== fid);

        // remove from fatBases
        Object.keys(fatBases).forEach(line => {
          Object.keys(fatBases[line]).forEach(baseName => {
            if (fatBases[line][baseName].fileId === fid) delete fatBases[line][baseName];
          });
          // cleanup empty line
          if (Object.keys(fatBases[line] || {}).length === 0) delete fatBases[line];
        });

        // remove baseGroups that reference removed file (either base or any target)
        baseGroups = baseGroups.filter(g => {
          if (g.base && g.base.fileId === fid) return false;
          const anyTargetFromFile = g.targets && g.targets.some(t => t.fileId === fid);
          return !anyTargetFromFile;
        });

        // remove any coverages that reference deleted file
        baseGroups.forEach(g => {
          if (g.coverages) g.coverages = g.coverages.filter(c => c.fileId !== fid);
        });

        // remove all DW polylines then redraw existing baseGroups
        map.eachLayer(layer => {
          if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
            try { map.removeLayer(layer); } catch(e) {}
          }
        });
        baseGroups.forEach(group => {
          group.targets.forEach(target => {
            L.polyline([[group.base.lat, group.base.lon], [target.lat, target.lon]], { color: 'magenta', weight: 1 }).addTo(map);
          });
        });

        renderSidebarFiles();
        renderFileList();
      }

      function setBaseMode() { mode = "base"; removeDraw(); }
      function setPolygonMode() { mode = "polygon"; removeDraw(); }
      function setPlacemarkMode() { mode = "placemark"; removeDraw(); }

      function setAreaMode() {
        mode = "area";
        removeDraw();
        drawControl = new L.Control.Draw({
          draw: {
            polygon: {
              shapeOptions: { color: 'blue', weight: 2 }
            },
            rectangle: false, polyline: false, circle: false, marker: false, circlemarker: false
          },
          edit: false
        });
        map.addControl(drawControl);
      }

      function removeDraw() {
        if (drawControl) {
          map.removeControl(drawControl);
          drawControl = null;
        }
      }

      function handleClick(event, marker, name, lat, lon) {
        if (mode === "base") {
          if (basePlacemark) resetMarkerIcon(basePlacemark.marker);
          // find placemark entry to carry fileId
          const p = placemarks.find(x => x.marker === marker || (x.lat === lat && x.lon === lon && x.name === name));
          basePlacemark = p ? { ...p } : { name, lat, lon, marker };
          marker.setIcon(L.icon({ 
              iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41] }));
          //marker.bindPopup(`Base: ${name}`).openPopup();
        } else if (mode === "placemark") {
          if (event.shiftKey) {
            const alreadySelected = selectedTargets.find(p => p.lat === lat && p.lon === lon);
            if (!alreadySelected) {
              // find placemark to include fileId
              const p = placemarks.find(x => x.marker === marker || (x.lat === lat && x.lon === lon && x.name === name));
              const item = p ? { name: p.name, lat: p.lat, lon: p.lon, marker: p.marker, fileId: p.fileId, fileName: p.fileName } : { name, lat, lon, marker };
              selectedTargets.push(item);
              marker.setIcon(L.icon({ 
                iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
              shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
              iconSize: [25, 41],
              iconAnchor: [12, 41],
              popupAnchor: [1, -34],
              shadowSize: [41, 41] }));
            }
          } else if (event.ctrlKey) {
            const index = selectedTargets.findIndex(p => p.lat === lat && p.lon === lon);
            if (index !== -1) {
              const selected = selectedTargets[index];
              resetMarkerIcon(selected.marker);
              selectedTargets.splice(index, 1);
            }
          }
        }
      }

      function handlePolygonClick(polygonLayer) {
        // When in 'polygon' mode: select points inside the polygon (as targets)
        // and record the polygon in selectedPolygons for later saving to COVERAGE.
        if (mode !== "polygon") return;
        // find polygon entry
        const entry = polygons.find(poly => poly.polygon === polygonLayer);
        if (!entry) return;
        // Keep polygon visual unchanged per user's request; just ensure it's recorded.
        if (!selectedPolygons.includes(entry)) selectedPolygons.push(entry);

        // Select contained placemarks as targets (same behavior as before)
        let latlngs = [];
        try { latlngs = polygonLayer.getLatLngs()[0]; } catch (e) { latlngs = []; }
        placemarks.forEach(p => {
          try {
            const point = L.latLng(p.lat, p.lon);
            if (leafletPointInPolygon(point, latlngs)) {
              if (basePlacemark && p.name === basePlacemark.name) return;
              const alreadySelected = selectedTargets.find(t => t.lat === p.lat && t.lon === p.lon);
              if (!alreadySelected) {
                const item = { name: p.name, lat: p.lat, lon: p.lon, marker: p.marker, fileId: p.fileId, fileName: p.fileName };
                selectedTargets.push(item);
                // visually mark selected targets with orange marker
                try {
                  p.marker.setIcon(L.icon({ 
                    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-orange.png',
                    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
                    iconSize: [25, 41],
                    iconAnchor: [12, 41]
                  }));
                } catch (e) {}
              }
            }
          } catch (e) {}
        });
      }
      function addLabeledMarker(name, lat, lon) {
        const marker = L.marker([lat, lon]).addTo(map);
        const label = L.marker([lat, lon], {
          icon: L.divIcon({
            className: 'marker-label',
            html: `<div class="marker-label">${name}</div>`,
            iconSize: [100, 20],
            iconAnchor: [20, 70]
          }),
          interactive: false
        }).addTo(map);
        
        return { marker, label };
      }

      map.on(L.Draw.Event.CREATED, function (e) {
        if (mode !== "area") return;
        const layer = e.layer;
        const polygonLatLngs = layer.getLatLngs()[0];
        map.removeLayer(layer);

        placemarks.forEach(p => {
          const point = L.latLng(p.lat, p.lon);
          if (basePlacemark && p.name === basePlacemark.name) return;
          if (leafletPointInPolygon(point, polygonLatLngs)) {
            const alreadySelected = selectedTargets.find(t => t.lat === p.lat && t.lon === p.lon);
            if (!alreadySelected) {
              selectedTargets.push({ name: p.name, lat: p.lat, lon: p.lon, marker: p.marker, fileId: p.fileId, fileName: p.fileName });
              p.marker.setIcon(L.icon({
                iconUrl: 'https://leafletjs.com/examples/custom-icons/leaf-orange.png',
                iconSize: [25, 41],
                iconAnchor: [12, 41]
              }));
            }
          }
        });

        removeDraw();
      });

      function leafletPointInPolygon(point, polygonLatLngs) {
        let x = point.lat, y = point.lng;
        let inside = false;
        for (let i = 0, j = polygonLatLngs.length - 1; i < polygonLatLngs.length; j = i++) {
          let xi = polygonLatLngs[i].lat, yi = polygonLatLngs[i].lng;
          let xj = polygonLatLngs[j].lat, yj = polygonLatLngs[j].lng;

          let intersect = ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
          if (intersect) inside = !inside;
        }
        return inside;
      }

      function generatePaths() {
        if (!basePlacemark || selectedTargets.length === 0) {
          alert("Pilih base dan target terlebih dahulu.");
          return;
        }

        baseGroups.push({
          base: basePlacemark,
          targets: [...selectedTargets],
          coverages: (selectedPolygons || []).map(p => ({ name: p.name, polygon: p.polygon, fileId: p.fileId, fileName: p.fileName }))
        });

        // Simpan base yang dipilih ke FAT untuk Line sesuai (jika termasuk Line A/B)
        try {
          const grp = baseGroups[baseGroups.length - 1];
          const baseName = grp.base?.name;
          if (baseName) {
            const name = (baseName || '').toLowerCase();
            const lines = ['a', 'b', 'c', 'd', 'e', 'f'];

            let ln = null;

            for (const letter of lines) {
                if (name.includes(letter)) {
                    ln = 'LINE ' + letter.toUpperCase();
                    break;
                }
            }
            if (ln) {
              fatBases[ln] = fatBases[ln] || {};
              // store basic info for FAT listing
              fatBases[ln][baseName] = { name: baseName, lat: grp.base.lat, lon: grp.base.lon, fileId: grp.base.fileId, fileName: grp.base.fileName };
            }
          }
        } catch (e) { /* ignore */ }

        // reset marker icons for UI
        selectedTargets.forEach(target => resetMarkerIcon(target.marker));
        if (basePlacemark && basePlacemark.marker) resetMarkerIcon(basePlacemark.marker);

        // clear polygon selection (we copied them into baseGroups.coverages)
        selectedPolygons = [];

        basePlacemark = null;
        selectedTargets = [];

        // rebuild polylines from baseGroups respecting file visibility
        rebuildDWPolylines();

        // Update file list UI after generation
        renderFileList();
      }

      function rebuildDWPolylines() {
        // remove existing DW polylines (not polygons)
        map.eachLayer(layer => {
          if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
            try { map.removeLayer(layer); } catch(e) {}
          }
        });

        baseGroups.forEach(group => {
          group.targets.forEach(target => {
            // check file visibility; if either file is hidden, skip drawing
            const baseFileVisible = !group.base.fileId || (filesData.find(f => f.id === group.base.fileId)?.visible !== false);
            const targetFileVisible = !target.fileId || (filesData.find(f => f.id === target.fileId)?.visible !== false);
            if (baseFileVisible && targetFileVisible) {
              L.polyline([[group.base.lat, group.base.lon], [target.lat, target.lon]], { color: 'magenta', weight: 1 }).addTo(map);
            }
          });
        });
      }
      function escapeXML(str) {
          return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
        }
      function exportKML() {
        // Build KML: produce HP only with structure: HP -> Line -> Folder(basepoint) -> point targets
        const docParts = [];

        // Helper to group by line name — return null for names that are not A or B
        function getLine(baseName) {
          const n = (baseName || '').toLowerCase();
          if (n.indexOf('a') !== -1) return 'LINE A';
          if (n.indexOf('b') !== -1) return 'LINE B';
          if (n.indexOf('c') !== -1) return 'LINE C';
          if (n.indexOf('d') !== -1) return 'LINE D';
          if (n.indexOf('e') !== -1) return 'LINE E';
          if (n.indexOf('f') !== -1) return 'LINE F';
          return null; // do not include Line Other
        }

        // Collect HP entries from baseGroups (use visibility from filesData)
        const hpLines = {};
        baseGroups.forEach(group => {
          if (!group || !group.base) return;
          const base = group.base;
          const line = getLine(base.name);
          if (!line) return;
          // check base file visibility
          const baseFileVisible = !base.fileId || (filesData.find(f => f.id === base.fileId)?.visible !== false);
          if (!baseFileVisible) return;
          hpLines[line] = hpLines[line] || {};
          hpLines[line][base.name] = hpLines[line][base.name] || [];
          (group.targets || []).forEach(t => {
            const targetFileVisible = !t.fileId || (filesData.find(f => f.id === t.fileId)?.visible !== false);
            if (targetFileVisible) hpLines[line][base.name].push(t);
          });
        });

        let hpBlock = '';
        Object.keys(hpLines).forEach(line => {
          let basesBlock = '';
          Object.keys(hpLines[line]).forEach(baseName => {
            let pts = '';
            (hpLines[line][baseName] || []).forEach(p => {
              pts += `\n          <Placemark><name>${escapeXML(p.name)}</name><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`;
            });
            basesBlock += `\n        <Folder><name>${escapeXML(baseName)}</name>${pts}\n        </Folder>`;
          });
          hpBlock += `\n      <Folder><name>${escapeXML(line)}</name>${basesBlock}\n      </Folder>`;
        });

        if (hpBlock) {
          docParts.push(`\n    <Folder><name>HP</name>${hpBlock}\n    </Folder>`);
        }

        // FAT folder: use fatBases captured when generatePaths ran (structure: FAT -> Line -> point placemarks)
        let fatBlock = '';
        Object.keys(fatBases || {}).forEach(line => {
          let placemarksBlock = '';
          Object.keys(fatBases[line] || {}).forEach(baseName => {
            const b = fatBases[line][baseName];
            // check file visibility
            const visible = !b.fileId || (filesData.find(f => f.id === b.fileId)?.visible !== false);
            if (!visible) return;
            placemarksBlock += `\n        <Placemark><name>${escapeXML(b.name)}</name><Point><coordinates>${b.lon},${b.lat},0</coordinates></Point></Placemark>`;
          });
          if (placemarksBlock) fatBlock += `\n      <Folder><name>${escapeXML(line)}</name>${placemarksBlock}\n      </Folder>`;
        });
        if (fatBlock) docParts.push(`\n    <Folder><name>FAT</name>${fatBlock}\n    </Folder>`);

        // COVERAGE folder: use polygons stored in baseGroups[].coverages (structure: COVERAGE -> Line -> polygon placemarks named by basepoint)
        let covBlock = '';
        // collect polygons per line
        const covPerLine = {};
        baseGroups.forEach(group => {
          const line = getLine(group.base.name);
          if (!line) return;
          const baseName = group.base.name;
          // check base file visibility
          const baseFileVisible = !group.base.fileId || (filesData.find(f => f.id === group.base.fileId)?.visible !== false);
          if (!baseFileVisible) return;
          (group.coverages || []).forEach(item => {
            // item: { name, polygon, fileId, fileName }
            covPerLine[line] = covPerLine[line] || [];
            covPerLine[line].push({ poly: item.polygon, base: baseName, fileId: item.fileId, targetCount: (group.targets || []).length });
          });
        });
        Object.keys(covPerLine).forEach(line => {
          let polysBlock = '';
          covPerLine[line].forEach(item => {
            // ensure visibility of polygon's source file if available
            const visible = !item.fileId || (filesData.find(f => f.id === item.fileId)?.visible !== false);
            if (!visible) return;
            const poly = item.poly;
            const baseName = item.base || 'COVERAGE';
            try {
              const coords = (poly.getLatLngs ? poly.getLatLngs()[0] : []).map(ll => `${ll.lng},${ll.lat},0`).join('\n                  ');
              const desc = `HP ${item.targetCount || 0}`;
              polysBlock += `\n        <Placemark><name>${escapeXML(baseName)}</name><description>${escapeXML(desc)}</description><Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`;
            } catch (e) { /* skip malformed */ }
          });
          if (polysBlock) covBlock += `\n      <Folder><name>${escapeXML(line)}</name>${polysBlock}\n      </Folder>`;
        });
        if (covBlock) docParts.push(`\n    <Folder><name>COVERAGE</name>${covBlock}\n    </Folder>`);

        // DW folder: produce LineStrings grouped per base (structure: DW -> Line -> Folder(basepoint) -> Placemark path 'base -> target')
        let dwBlock = '';
        const dwPerLine = {};
        baseGroups.forEach(group => {
          if (!group || !group.base) return;
          const line = getLine(group.base.name);
          if (!line) return;
          const base = group.base;
          // check base visibility
          const baseVisible = !base.fileId || (filesData.find(f => f.id === base.fileId)?.visible !== false);
          if (!baseVisible) return;
          dwPerLine[line] = dwPerLine[line] || {};
          const list = dwPerLine[line][base.name] = dwPerLine[line][base.name] || [];
          (group.targets || []).forEach(t => {
            // check target visibility
            const targetVisible = !t.fileId || (filesData.find(f => f.id === t.fileId)?.visible !== false);
            if (!targetVisible) return;
            list.push(t);
          });
        });
        Object.keys(dwPerLine).forEach(line => {
          let basesBlock = '';
          Object.keys(dwPerLine[line]).forEach(baseName => {
            let pathsBlock = '';
            (dwPerLine[line][baseName] || []).forEach(t => {
              const bLat = (baseGroups.find(g=>g.base && g.base.name===baseName)?.base?.lat) || '';
              const bLon = (baseGroups.find(g=>g.base && g.base.name===baseName)?.base?.lon) || '';
              pathsBlock += `\n          <Placemark><name>${escapeXML(baseName)} -> ${escapeXML(t.name)}</name><LineString><coordinates>\n                    ${bLon},${bLat},0\n                    ${t.lon},${t.lat},0\n                  </coordinates></LineString></Placemark>`;
            });
            basesBlock += `\n        <Folder><name>${escapeXML(baseName)}</name>${pathsBlock}\n        </Folder>`;
          });
          if (basesBlock) dwBlock += `\n      <Folder><name>${escapeXML(line)}</name>${basesBlock}\n      </Folder>`;
        });
        if (dwBlock) docParts.push(`\n    <Folder><name>DW</name>${dwBlock}\n    </Folder>`);

        if (docParts.length === 0) { alert('Tidak ada data HP untuk diekspor.'); return; }

        //const rootName = filesData[0]?.name || 'BTX_file.kml';
        const rootName = 'BTX_file.kml';
        const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${escapeXML(rootName)}</name>\n    ${docParts.join('\n    ')}\n  </Document>\n</kml>`;

        const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = rootName.replace(/\.kml$/i, '') + '.kml';
        link.click();
      }

      function resetMarkerIcon(marker) {
        marker.setIcon(new L.Icon.Default());
      }

      function resetAll() {
        basePlacemark = null;
        selectedTargets.forEach(p => {
          resetMarkerIcon(p.marker);
          //if (p.label) map.removeLayer(p.label); // hapus label juga
        });
        selectedTargets = [];

        // clear selected polygons list (no style changes)
        selectedPolygons = [];

        placemarks.forEach(p => {
          resetMarkerIcon(p.marker);
          //if (p.label) map.removeLayer(p.label); // hapus label juga
        });

        map.eachLayer(layer => {
          if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
            map.removeLayer(layer);
          }
        });
      }