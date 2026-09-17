const INITIAL_FORMAT={color:'#303133',fontSize:14,bold:false,italic:false,underline:false,strike:false,textAlign:'left'};
let state={projects:[],currentProject:null,currentVersion:null,versions:{},expandedProjects:new Set(),columns:[],cases:[],merges:[],page:1,pageSize:100,total:0,keyword:'',statusFilters:[],summaryFieldKey:'remark',summaryShowImages:false,columnTotals:{},columnUnits:{},editingCase:null,editingCell:null,inlineEditing:null,editMode:false,mergeMode:false,mergeAnchor:null,sidebarCollapsed:false,quickAddRow:false,actionsCollapsed:true,currentUser:null,quickInsertTarget:null,quickInsertCount:1,pendingImages:[],pendingEmbeddedImages:[],caseImages:[],caseModalUploadedImageIds:[],caseModalSaving:false,formatRowCaseId:null,formatPainterStyle:null,formatPainterSource:null,formatToolbarInteraction:false,defaultFormats:{},defaultFormat:{...INITIAL_FORMAT},quickFormatColor:'#f56c6c',casesLoadSerial:0,statsLoadSerial:0,requirements:[],requirementScope:null,editingRequirement:null,requirementCreating:false,requirementPendingFiles:[]};
let draggedVersion=null;
let versionJustDragged=false;
let pendingCellClick=null;
const recentPasteByTarget=new WeakMap();
const STATUS_LIST=['通过','失败','未执行','阻塞','跳过'];
const STATUS_COLORS={'通过':'#67c23a','失败':'#f56c6c','未执行':'#909399','阻塞':'#e6a23c','跳过':'#409eff'};
const STATUS_ALIASES={'pass':'通过','passed':'通过','success':'通过','成功':'通过','fail':'失败','failed':'失败','failure':'失败','not run':'未执行','notrun':'未执行','pending':'未执行','blocked':'阻塞','block':'阻塞','skip':'跳过','skipped':'跳过'};
function $(s){return document.querySelector(s);}
function $$(s){return document.querySelectorAll(s);}
function escapeHtml(value){return (value??'').toString().replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function normalizeStatus(value){
  const raw=(value??'').toString().trim();
  return STATUS_ALIASES[raw.toLowerCase()]||raw;
}
function updateStatusFilterUI(){
  const container=$('#status-filter');
  const trigger=$('#status-filter-trigger');
  if(!container||!trigger)return;
  const selected=state.statusFilters||[];
  trigger.textContent=selected.length?`执行结果：${selected.join('、')}`:'执行结果：全部';
  container.querySelectorAll('input[name="status-filter-option"]').forEach(input=>{
    input.checked=selected.includes(input.value);
  });
}

function formatScopeKey(){
  if(!state.currentProject||!state.currentVersion)return null;
  return `${state.currentProject.id}:${state.currentVersion.id}`;
}

function activateFormatScope(){
  const key=formatScopeKey();
  if(!key){state.defaultFormat={...INITIAL_FORMAT};return state.defaultFormat;}
  if(!state.defaultFormats[key])state.defaultFormats[key]={...INITIAL_FORMAT};
  state.defaultFormat=state.defaultFormats[key];
  return state.defaultFormat;
}

function toggleStatusFilter(){
  const container=$('#status-filter');
  if(container)container.classList.toggle('open');
}
function onStatusFilterChange(){
  state.statusFilters=Array.from(document.querySelectorAll('input[name="status-filter-option"]:checked')).map(input=>input.value);
  updateStatusFilterUI();
  state.page=1;
  loadCases();
}
let projectNameTooltip=null;
function hideProjectNameTooltip(){
  if(projectNameTooltip) projectNameTooltip.style.display='none';
}
function showProjectNameTooltip(target){
  const fullName=target?.dataset.fullName||'';
  if(!fullName || fullName.length<16)return;
  if(!projectNameTooltip){
    projectNameTooltip=document.createElement('div');
    projectNameTooltip.className='project-name-tooltip';
    document.body.appendChild(projectNameTooltip);
  }
  projectNameTooltip.textContent=fullName;
  projectNameTooltip.style.display='block';
  const rect=target.getBoundingClientRect();
  const margin=12;
  const maxLeft=Math.max(margin,window.innerWidth-projectNameTooltip.offsetWidth-margin);
  const left=Math.min(Math.max(margin,rect.left),maxLeft);
  let top=rect.bottom+6;
  if(top+projectNameTooltip.offsetHeight>window.innerHeight-margin){
    top=Math.max(margin,rect.top-projectNameTooltip.offsetHeight-6);
  }
  projectNameTooltip.style.left=`${left}px`;
  projectNameTooltip.style.top=`${top}px`;
}
function bindProjectNameTooltip(target){
  target.addEventListener('mouseenter',()=>showProjectNameTooltip(target));
  target.addEventListener('mouseleave',hideProjectNameTooltip);
}
async function api(url,opts={}){
  const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.message||`请求失败 ${res.status}`);
  return data;
}
function showToast(msg,type='success'){
  const el=$('#toast');el.textContent=msg;el.className=`toast show ${type}`;
  setTimeout(()=>el.classList.remove('show'),2500);
}
function openModal(id){$(id).classList.add('active');}
function closeModal(id){
  if(id==='#case-modal'&&!state.caseModalSaving&&state.caseModalUploadedImageIds.length){
    void deleteImageRecords(state.caseModalUploadedImageIds);
    state.caseModalUploadedImageIds=[];
  }
  if(id==='#requirement-modal'){
    state.editingRequirement=null;
    state.requirementCreating=false;
    state.requirementPendingFiles=[];
    state.requirementScope=null;
  }
  $(id).classList.remove('active');
}

async function doLogin(){
  try{
    const res=await api('/login',{method:'POST',body:JSON.stringify({username:$('#login-username').value,password:$('#login-password').value})});
    if(res.success){
      state.currentUser=res.data;
      $('#login-page').style.display='none';
      $('#app').style.display='flex';
      applyRoleUI();
      await initApp();
    }
  }catch(err){showToast(err.message,'error');}
}

function applyRoleUI(){
  const isAdmin=state.currentUser?.can_manage===true;
  const isReadonly=state.currentUser?.can_write!==true;
  const roleHint=$('#current-user-role');
  if(roleHint){
    const user=state.currentUser||{};
    const roleName=user.role_name||'未识别角色';
    const permission=isAdmin?'可管理项目、版本、用例和备份':isReadonly?'仅可查看和导出':'可编辑用例和执行结果';
    roleHint.textContent=`当前账号：${user.username||''}｜${roleName}｜${permission}`;
    roleHint.className=`account-role-hint ${isAdmin?'role-admin':isReadonly?'role-readonly':'role-test'}`;
  }
  $$('.admin-only').forEach(el=>el.style.display=isAdmin?'inline-flex':'none');
  ['btn-add-project','btn-add-version','btn-quick-add','btn-add-case','btn-batch-delete',
   'btn-merge-cells','btn-unmerge-cells','btn-import','btn-columns','edit-mode-toggle']
    .forEach(id=>{const el=$(`#${id}`);if(el)el.disabled=isReadonly;});
  if(isReadonly){
    state.editMode=false;
    const toggle=$('#edit-mode-toggle');if(toggle)toggle.checked=false;
  }
  updateEditModeUI();
}
$('#login-form').addEventListener('submit',e=>{e.preventDefault();doLogin();});

async function initApp(){
  await loadProjects();
  if(state.projects.length){
    // 登录后优先进入第一个有版本的项目，避免最新创建的空项目
    // 让用户误以为当前账号没有数据；项目和版本数据仍按账号权限从接口读取。
    let selectedProject=null;
    for(const project of state.projects){
      await loadVersionsForProject(project.id);
      if(!selectedProject&&(state.versions[project.id]||[]).length)selectedProject=project;
    }
    const p=selectedProject||state.projects[0];
    state.expandedProjects.add(p.id);state.currentProject=p;renderProjects();
    $('#current-project-name').textContent=p.name;
    const firstVersion=(state.versions[p.id]||[])[0];
    if(firstVersion)await selectVersion(firstVersion.id,p.id);
  }else{renderProjects();}
}

async function loadProjects(){
  const res=await api('/api/projects');state.projects=res.data||[];
}

function renderProjects(){
  const list=$('#project-list');list.innerHTML='';
  if(!state.projects.length){list.innerHTML='<div class="empty-state" style="padding:20px">暂无项目</div>';return;}
  state.projects.forEach(p=>{
    const expanded=state.expandedProjects.has(p.id);
    const canManage=state.editMode&&state.currentUser?.can_manage===true;
    const node=document.createElement('div');node.className='project-node';
    node.innerHTML=`<div class="project-header ${state.currentProject?.id===p.id?'active':''}" onclick="toggleProject(${p.id})">
      <span class="project-arrow ${expanded?'expanded':''}">▶</span>
      <span class="project-name" title="${escapeHtml(p.name)}" data-full-name="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
      ${canManage?`<div class="project-actions">
        <button class="secondary" onclick="event.stopPropagation();editProject(${p.id})">编辑</button>
        <button class="danger" onclick="event.stopPropagation();deleteProject(${p.id})">删除</button>
      </div>`:''}
    </div><div class="version-list ${expanded?'expanded':''}"></div>`;
    list.appendChild(node);
    bindProjectNameTooltip(node.querySelector('.project-name'));
    const vList=node.querySelector('.version-list');
    const versions=state.versions[p.id]||[];
    if(expanded){
      if(versions.length){
        versions.forEach(v=>{
          const vi=document.createElement('div');vi.className='version-item'+(state.currentVersion?.id===v.id?' active':'');
          vi.dataset.versionId=v.id;
          if(state.editMode){vi.draggable=true;vi.classList.add('version-sortable');}
          vi.innerHTML=`${state.editMode?'<span class="version-drag-handle" title="拖动排序">⋮⋮</span>':''}<span class="version-name" title="${escapeHtml(v.version_name)}" data-full-name="${escapeHtml(v.version_name)}">${escapeHtml(v.version_name)}</span>
            ${canManage?`<div class="version-actions"><button class="secondary" onclick="event.stopPropagation();editVersion(${p.id},${v.id})">编辑</button><button class="danger" onclick="event.stopPropagation();deleteVersion(${p.id},${v.id})">删除</button></div>`:''}`;
          vi.onclick=e=>{
            if(versionJustDragged){versionJustDragged=false;return;}
            if(e.target.closest('.version-actions'))return;
            state.currentProject=p;
            state.expandedProjects.add(p.id);
            $('#current-project-name').textContent=p.name;
            selectVersion(v.id,p.id);
          };
          vi.addEventListener('contextmenu',e=>{
            if(!state.editMode||state.currentUser?.can_write!==true)return;
            e.preventDefault();e.stopPropagation();showVersionContextMenu(e,p.id,v.id);
          });
          if(state.editMode){
            vi.addEventListener('dragstart',e=>{
              draggedVersion=vi;versionJustDragged=true;vi.classList.add('dragging');
              e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',String(v.id));
              e.stopPropagation();
            });
            vi.addEventListener('dragover',e=>{
              e.preventDefault();e.stopPropagation();
              if(!draggedVersion||draggedVersion===vi)return;
              const rect=vi.getBoundingClientRect();
              if(e.clientY<rect.top+rect.height/2)vList.insertBefore(draggedVersion,vi);
              else vList.insertBefore(draggedVersion,vi.nextSibling);
              e.dataTransfer.dropEffect='move';
            });
            vi.addEventListener('dragend',async e=>{
              e.stopPropagation();vi.classList.remove('dragging');
              if(draggedVersion===vi){draggedVersion=null;await saveVersionOrder(p.id,vList);}
              setTimeout(()=>{versionJustDragged=false;},0);
            });
          }
          vList.appendChild(vi);
          bindProjectNameTooltip(vi.querySelector('.version-name'));
        });
      }else{vList.innerHTML='<div class="version-empty">暂无版本，点击“新建版本”创建</div>';}
    }
  });
}

async function saveVersionOrder(projectId,list){
  const orders={};
  Array.from(list.querySelectorAll('.version-item')).forEach((item,index)=>{orders[item.dataset.versionId]=index;});
  try{
    const res=await api(`/api/projects/${projectId}/versions/order`,{method:'POST',body:JSON.stringify({orders})});
    state.versions[projectId]=res.data||state.versions[projectId];
    renderProjects();
    showToast('版本排序已保存');
  }catch(err){
    await loadVersionsForProject(projectId);renderProjects();showToast(err.message,'error');
  }
}

async function toggleProject(id){
  const project=state.projects.find(p=>p.id===id);
  if(!project)return;
  const switchingProject=state.currentProject?.id!==id;
  if(switchingProject){
    state.currentProject=project;
    state.currentVersion=null;
    state.columns=[];state.cases=[];state.merges=[];state.total=0;state.page=1;
    state.quickAddRow=false;state.quickInsertTarget=null;state.mergeMode=false;state.mergeAnchor=null;
    $('#current-version-name').textContent='';
    $('#stats-bar').innerHTML='<span>共 0 条</span>';
    renderTable();renderPagination();
  }
  if(state.expandedProjects.has(id)){state.expandedProjects.delete(id);}else{state.expandedProjects.add(id);await loadVersionsForProject(id);}
  renderProjects();$('#current-project-name').textContent=state.currentProject?.name||'未选择项目';
}

async function loadVersionsForProject(projectId){
  const res=await api(`/api/projects/${projectId}/versions`);state.versions[projectId]=res.data||[];
}

async function selectVersion(id,projectId=null){
  const targetProjectId=projectId??state.currentProject?.id;
  const project=state.projects.find(item=>item.id===targetProjectId);
  if(!project)return;
  state.currentProject=project;
  const versions=state.versions[targetProjectId]||[];
  // 版本 ID 在全库唯一，但请求必须同时使用它所属的项目 ID，防止
  // 切换项目过程中残留旧项目状态，生成 /projects/A/versions/B 的错误地址。
  state.currentVersion=versions.find(v=>Number(v.id)===Number(id)&&Number(v.project_id)===Number(targetProjectId));
  activateFormatScope();
  state.page=1;state.pageSize=100;state.statusFilters=[];state.summaryFieldKey='remark';state.summaryShowImages=false;state.columnTotals={};state.columnUnits={};state.columns=[];updateStatusFilterUI();
  if(!state.currentVersion)return;
  renderCurrentVersionName();
  await Promise.all([loadColumns(),loadCases(),loadStats()]);
  renderProjects();
  $('#current-project-name').textContent=project.name;
  renderCurrentVersionName();
}

function showVersionContextMenu(event,projectId,versionId){
  removeContextMenu();removeVersionContextMenu();
  const menu=document.createElement('div');menu.id='version-context-menu';menu.className='context-menu';
  menu.style.left=event.pageX+'px';menu.style.top=event.pageY+'px';
  const canManage=state.currentUser?.can_manage===true;
  menu.innerHTML=`<div data-action="create-requirement">创建需求记录</div>${canManage?'<div data-action="copy-version">创建版本副本</div>':''}`;
  menu.querySelector('[data-action="create-requirement"]')?.addEventListener('click',()=>{menu.remove();openRequirementModal(projectId,versionId);});
  menu.querySelector('[data-action="copy-version"]')?.addEventListener('click',()=>{menu.remove();createVersionCopy(projectId,versionId);});
  document.body.appendChild(menu);
  document.addEventListener('click',removeVersionContextMenu,{once:true});
}

function removeVersionContextMenu(){const menu=$('#version-context-menu');if(menu)menu.remove();}

async function createVersionCopy(projectId,versionId){
  const source=(state.versions[projectId]||[]).find(version=>version.id===versionId);
  if(!source)return;
  const name=prompt(`基于“${source.version_name}”创建副本，输入副本名称：`);
  if(name===null||!name.trim())return;
  if(!confirm(`确定创建版本副本“${name.trim()}”吗？将复制该版本的用例、执行结果、图片和合并关系。`))return;
  try{
    const res=await api(`/api/projects/${projectId}/versions/${versionId}/copy`,{method:'POST',body:JSON.stringify({version_name:name.trim()})});
    await loadVersionsForProject(projectId);renderProjects();
    showToast(`版本副本创建成功，共复制 ${res.data?.copied_cases??0} 条用例`);
  }catch(err){showToast(err.message,'error');}
}

const REQUIREMENT_TYPE_NAMES={memo:'备忘录',text:'文字',table:'表格',image:'图片'};

function requirementDefaultTable(){return [['字段','内容'],['','']];}

async function loadRequirementsForScope(){
  const scope=state.requirementScope;
  if(!scope)return;
  const res=await api(`/api/projects/${scope.projectId}/versions/${scope.versionId}/requirements`);
  state.requirements=res.data||[];
}

function requirementTableHtml(rows,editable=false){
  const data=Array.isArray(rows)&&rows.length?rows:requirementDefaultTable();
  if(!editable){
    return `<table class="requirement-display-table"><tbody>${data.map(row=>`<tr>${(row||[]).map(cell=>`<td>${escapeHtml(cell).replace(/\r?\n/g,'<br>')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  }
  return `<div class="requirement-table-editor" id="requirement-table-editor"><table><tbody>${data.map((row,rowIndex)=>`<tr>${(row||[]).map((cell,colIndex)=>`<td><input data-row="${rowIndex}" data-col="${colIndex}" value="${escapeHtml(cell)}" placeholder="请输入内容"></td>`).join('')}<td class="requirement-table-row-action"><button type="button" class="danger" onclick="removeRequirementTableRow(${rowIndex})">删除行</button></td></tr>`).join('')}</tbody></table><button type="button" class="secondary" onclick="addRequirementTableRow()">添加行</button></div>`;
}

// 需求正文是可编辑 HTML。只允许备忘录实际需要的标签，避免把外部页面的脚本、事件属性
// 或样式直接带进页面；图片只接受本系统接口地址，图片本体仍然保存在 MySQL。
function sanitizeRequirementHtml(value){
  const template=document.createElement('template');
  template.innerHTML=(value??'').toString();
  const allowed=new Set(['BR','B','STRONG','I','EM','U','S','STRIKE','DEL','P','DIV','SPAN','UL','OL','LI','TABLE','THEAD','TBODY','TFOOT','TR','TH','TD','IMG']);
  const walker=document.createTreeWalker(template.content,NodeFilter.SHOW_ELEMENT);
  const elements=[];let node;
  while(node=walker.nextNode())elements.push(node);
  elements.forEach(element=>{
    if(!allowed.has(element.tagName)){
      const parent=element.parentNode;
      while(element.firstChild)parent?.insertBefore(element.firstChild,element);
      element.remove();
      return;
    }
    Array.from(element.attributes).forEach(attribute=>{
      const keep=attribute.name==='class'&&attribute.value==='rich-content-image'
        ||attribute.name==='data-requirement-image-id'
        ||attribute.name==='contenteditable'&&element.tagName==='TD'
        ||attribute.name==='colspan'||attribute.name==='rowspan';
      if(!keep)element.removeAttribute(attribute.name);
    });
    if(element.tagName==='IMG'){
      const imageId=Number(element.getAttribute('data-requirement-image-id'));
      if(!Number.isInteger(imageId)||imageId<=0){element.remove();return;}
      element.setAttribute('src',`/api/requirement-images/${imageId}/content`);
      element.setAttribute('alt','图片');
      element.className='rich-content-image';
    }
  });
  return template.innerHTML;
}

function requirementTableContentHtml(rows){
  const data=Array.isArray(rows)&&rows.length?rows:requirementDefaultTable();
  return `<table class="requirement-memo-table"><tbody>${data.map(row=>`<tr>${(row||[]).map(cell=>`<td>${escapeHtml(cell??'')}</td>`).join('')}</tr>`).join('')}</tbody></table><p><br></p>`;
}

function requirementImageMarkup(images){
  return (images||[]).map(image=>`<p><img class="rich-content-image" data-requirement-image-id="${Number(image.id)}" src="${escapeHtml(image.content_url||`/api/requirement-images/${image.id}/content`)}" alt="图片"></p>`).join('');
}

function requirementContentHtml(record){
  if(!record)return '';
  let content=record.content||'';
  // 兼容改版前的表格/图片记录：第一次编辑时转换成备忘录正文，不丢旧数据。
  if(!content&&record.record_type==='table')content=requirementTableContentHtml(record.table_data||[]);
  if(!content&&record.images?.length)content=requirementImageMarkup(record.images);
  return sanitizeRequirementHtml(content);
}

function requirementImageIdsFromHtml(html){
  const template=document.createElement('template');template.innerHTML=html||'';
  return new Set(Array.from(template.content.querySelectorAll('img[data-requirement-image-id]'))
    .map(image=>Number(image.dataset.requirementImageId)).filter(id=>Number.isInteger(id)&&id>0));
}

function collectRequirementTable(){
  const rows={};
  $$('#requirement-table-editor input[data-row]').forEach(input=>{
    const row=Number(input.dataset.row);const col=Number(input.dataset.col);
    if(!rows[row])rows[row]=[];rows[row][col]=input.value;
  });
  return Object.keys(rows).sort((a,b)=>Number(a)-Number(b)).map(key=>rows[key].map(value=>value??''));
}

function addRequirementTableRow(){
  const tbody=$('#requirement-table-editor tbody');if(!tbody)return;
  const width=Math.max(2,tbody.querySelector('tr')?.querySelectorAll('input[data-col]').length||2);
  const rowIndex=tbody.querySelectorAll('tr').length;
  const row=document.createElement('tr');
  row.innerHTML=`${Array.from({length:width},(_,colIndex)=>`<td><input data-row="${rowIndex}" data-col="${colIndex}" value="" placeholder="请输入内容"></td>`).join('')}<td class="requirement-table-row-action"><button type="button" class="danger" onclick="removeRequirementTableRow(${rowIndex})">删除行</button></td>`;
  tbody.appendChild(row);
}

function removeRequirementTableRow(index){
  const tbody=$('#requirement-table-editor tbody');if(!tbody)return;
  const rows=tbody.querySelectorAll('tr');
  if(rows.length<=1){showToast('至少保留一行','error');return;}
  rows[index]?.remove();
  tbody.querySelectorAll('tr').forEach((row,rowIndex)=>row.querySelectorAll('input[data-col]').forEach((input,colIndex)=>{input.dataset.row=rowIndex;input.dataset.col=colIndex;row.querySelector('button')?.setAttribute('onclick',`removeRequirementTableRow(${rowIndex})`);}));
}

function renderRequirementList(){
  const list=$('#requirement-list');if(!list)return;
  const canWrite=state.currentUser?.can_write===true;
  if(!state.requirements.length){list.innerHTML='<div class="empty-state requirement-empty">当前版本暂无需求记录</div>';return;}
  list.innerHTML=state.requirements.map(record=>{
    const content=requirementContentHtml(record)||'<span class="empty">未填写正文，点击编辑补充</span>';
    return `<article class="requirement-card"><div class="requirement-card-header"><div><strong>${escapeHtml(record.title)}</strong><span class="requirement-type-badge">${REQUIREMENT_TYPE_NAMES[record.record_type]||'备忘录'}</span></div><span class="requirement-time">${escapeHtml(record.updated_at||record.created_at||'')}</span></div><div class="requirement-card-content requirement-memo-content">${content}</div>${canWrite?`<div class="requirement-card-actions"><button type="button" class="secondary" onclick="editRequirement(${record.id})">编辑正文</button><button type="button" class="danger" onclick="deleteRequirement(${record.id})">删除</button></div>`:''}</article>`;
  }).join('');
}

function renderRequirementModal(){
  const body=$('#requirement-body');if(!body)return;
  const record=state.editingRequirement;
  const canWrite=state.currentUser?.can_write===true;
  body.innerHTML=`<div class="requirement-scope-tip">当前版本：${escapeHtml(state.requirementScope?.versionName||'')}</div>
    <div class="requirement-toolbar"><strong>需求记录列表</strong>${canWrite?'<button type="button" class="success" onclick="newRequirement()">新建需求记录</button>':''}</div>
    <div id="requirement-list"></div>
    ${canWrite&&record?`<div class="requirement-editor"><div class="requirement-editor-heading"><h4>编辑需求正文</h4><span class="editor-tip">正文支持文字、表格和 Ctrl+V 粘贴图片</span></div><label>需求标题<input id="requirement-title-input" value="${escapeHtml(record.title||'')}" placeholder="请输入需求标题"></label><div class="requirement-memo-toolbar"><button type="button" class="secondary" onclick="insertRequirementTable()">插入表格</button><span>表格单元格可直接输入，图片点击可放大</span></div><div id="requirement-content-editor" class="requirement-content-editor rich-editor" contenteditable="true" role="textbox" aria-label="需求正文" data-placeholder="请输入需求正文">${requirementContentHtml(record)}</div></div>`:canWrite&&state.requirementCreating?`<div class="requirement-editor requirement-title-creator"><h4>新建需求记录</h4><span class="editor-tip">先填写标题，创建后进入正文编辑页面，正文可稍后补充。</span><label>需求标题<input id="new-requirement-title-input" placeholder="请输入需求标题（必填）" autofocus></label><button type="button" onclick="createRequirementFromTitle()">进入正文编辑</button></div>`:''}`;
  const saveButton=$('#save-requirement-btn');if(saveButton)saveButton.style.display=canWrite&&record?'':'none';
  renderRequirementList();
}

function newRequirement(){
  if(!state.requirementScope||state.currentUser?.can_write!==true)return;
  state.editingRequirement=null;state.requirementCreating=true;renderRequirementModal();
  $('#new-requirement-title-input')?.focus();
}

async function createRequirementFromTitle(){
  if(!state.requirementScope||state.currentUser?.can_write!==true)return;
  const title=$('#new-requirement-title-input')?.value.trim()||'';
  if(!title){showToast('需求标题不能为空','error');$('#new-requirement-title-input')?.focus();return;}
  try{
    const result=await api(`/api/projects/${state.requirementScope.projectId}/versions/${state.requirementScope.versionId}/requirements`,{method:'POST',body:JSON.stringify({title:title.trim(),record_type:'memo',content:'',table_data:[]})});
    state.editingRequirement={...result.data,images:(result.data.images||[]).map(image=>({...image}))};
    state.requirementCreating=false;
    await loadRequirementsForScope();
    renderRequirementModal();
    showToast('需求已创建，请补充正文');
  }catch(err){showToast(err.message,'error');}
}

function editRequirement(id){
  const record=state.requirements.find(item=>Number(item.id)===Number(id));
  if(!record)return;
  state.editingRequirement={...record,table_data:(record.table_data||[]).map(row=>Array.isArray(row)?row.slice():[]),images:(record.images||[]).map(image=>({...image}))};
  state.requirementCreating=false;
  renderRequirementModal();
}

async function deleteRequirement(id){
  if(!confirm('确定删除这条需求记录吗？关联图片也会删除。'))return;
  try{await api(`/api/requirements/${id}`,{method:'DELETE'});await loadRequirementsForScope();renderRequirementModal();showToast('需求记录已删除');}
  catch(err){showToast(err.message,'error');}
}

async function uploadRequirementImages(id,files){
  if(!files.length)return [];
  const form=new FormData();files.forEach(file=>form.append('images',file));
  const response=await fetch(`/api/requirements/${id}/images`,{method:'POST',body:form});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(result.message||'需求图片上传失败');
  return result.data||[];
}

async function saveRequirement(){
  if(!state.requirementScope||state.currentUser?.can_write!==true)return;
  const title=$('#requirement-title-input')?.value.trim()||'';
  if(!title){showToast('需求标题不能为空','error');return;}
  const editor=$('#requirement-content-editor');
  if(!editor||!state.editingRequirement)return;
  const content=sanitizeRequirementHtml(editor.innerHTML);
  const currentImageIds=requirementImageIdsFromHtml(content);
  const previousImageIds=new Set((state.editingRequirement.images||[]).map(image=>Number(image.id)));
  const payload={title,record_type:'memo',content,table_data:[]};
  try{
    const result=await api(`/api/requirements/${state.editingRequirement.id}`,{method:'PUT',body:JSON.stringify(payload)});
    for(const imageId of previousImageIds){if(!currentImageIds.has(imageId))await api(`/api/requirement-images/${imageId}`,{method:'DELETE'});}
    state.editingRequirement=result.data;
    await loadRequirementsForScope();
    state.editingRequirement=null;renderRequirementModal();showToast('需求记录保存成功');
  }catch(err){showToast(err.message,'error');}
}

function insertRequirementTable(){
  const editor=$('#requirement-content-editor');if(!editor)return;
  const table='<table class="requirement-memo-table"><tbody><tr><td> </td><td> </td></tr><tr><td> </td><td> </td></tr></tbody></table><p><br></p>';
  insertPastedContentAtCaret(editor,table,captureRichSelection(editor));
}

async function openRequirementModal(projectId=null,versionId=null){
  const project=state.projects.find(item=>Number(item.id)===Number(projectId??state.currentProject?.id));
  const versions=state.versions[project?.id]||[];
  const version=versions.find(item=>Number(item.id)===Number(versionId??state.currentVersion?.id));
  if(!project||!version){showToast('请先选择有效版本','error');return;}
  state.requirementScope={projectId:project.id,versionId:version.id,versionName:`${project.name} / ${version.version_name}`};
  state.editingRequirement=null;state.requirementCreating=false;state.requirementPendingFiles=[];
  try{await loadRequirementsForScope();renderRequirementModal();openModal('#requirement-modal');}
  catch(err){showToast(err.message,'error');}
}

async function createProject(){
  const name=prompt('请输入项目名称：');if(!name)return;
  try{
    const res=await api('/api/projects',{method:'POST',body:JSON.stringify({name})});
    await loadProjects();const p=res.data;
    state.expandedProjects.add(p.id);state.currentProject=p;state.versions[p.id]=[];state.currentVersion=null;
    renderProjects();$('#current-project-name').textContent=p.name;$('#current-version-name').textContent='';
    $('#stats-bar').innerHTML='<span>共 0 条</span>';
    showToast('项目创建成功');
  }catch(err){showToast(err.message,'error');}
}

async function editProject(id){
  const p=state.projects.find(x=>x.id===id);const name=prompt('项目名称：',p.name);if(name===null)return;
  try{await api(`/api/projects/${id}`,{method:'PUT',body:JSON.stringify({name,description:p.description})});await loadProjects();renderProjects();if(state.currentProject?.id===id){$('#current-project-name').textContent=name;}showToast('项目更新成功');}catch(err){showToast(err.message,'error');}
}

async function deleteProject(id){
  const pwd=prompt('删除项目需要密码：');if(pwd===null)return;
  if(!confirm('确定要删除该项目吗？所有版本、用例、图片将被清空，此操作不可恢复。'))return;
  try{
    await api(`/api/projects/${id}`,{method:'DELETE',body:JSON.stringify({password:pwd})});
    state.expandedProjects.delete(id);delete state.versions[id];
    if(state.currentProject?.id===id){state.currentProject=null;state.currentVersion=null;}
    await loadProjects();renderProjects();
    if(state.projects.length){const f=state.projects[0];state.expandedProjects.add(f.id);state.currentProject=f;await loadVersionsForProject(f.id);renderProjects();$('#current-project-name').textContent=f.name;}
    else{$('#current-project-name').textContent='未选择项目';$('#current-version-name').textContent='';$('#stats-bar').innerHTML='<span>共 0 条</span>';$('#case-table tbody').innerHTML='<tr><td colspan="100" class="empty-state">暂无项目</td></tr>';$('#pagination').innerHTML='';}
    showToast('项目已删除');
  }catch(err){showToast(err.message,'error');}
}

async function createVersion(){
  if(!state.currentProject){showToast('请先选择一个项目','error');return;}
  const name=prompt('请输入版本名称：');if(!name)return;
  try{await api(`/api/projects/${state.currentProject.id}/versions`,{method:'POST',body:JSON.stringify({version_name:name})});await loadVersionsForProject(state.currentProject.id);renderProjects();showToast('版本创建成功');}catch(err){showToast(err.message,'error');}
}

async function editVersion(projectId,versionId){
  const version=(state.versions[projectId]||[]).find(v=>v.id===versionId);if(!version)return;
  const name=prompt('版本名称：',version.version_name);if(name===null||!name.trim())return;
  try{
    await api(`/api/projects/${projectId}/versions/${versionId}`,{method:'PUT',body:JSON.stringify({version_name:name.trim()})});
    await loadVersionsForProject(projectId);renderProjects();
    if(state.currentVersion?.id===versionId){state.currentVersion=(state.versions[projectId]||[]).find(v=>v.id===versionId);renderCurrentVersionName();}
    showToast('版本更新成功');
  }catch(err){showToast(err.message,'error');}
}

async function deleteVersion(projectId,versionId){
  const pwd=prompt('删除版本需要密码：');if(pwd===null)return;
  if(!confirm('确定删除该版本？版本下所有用例、图片将被清空，此操作不可恢复。'))return;
  try{
    await api(`/api/projects/${projectId}/versions/${versionId}`,{method:'DELETE',body:JSON.stringify({password:pwd})});
    await loadVersionsForProject(projectId);
    if(state.currentVersion?.id===versionId){state.currentVersion=null;state.cases=[];state.total=0;$('#case-table thead').innerHTML='';$('#case-table tbody').innerHTML='<tr><td colspan="100" class="empty-state">请选择版本</td></tr>';$('#pagination').innerHTML='';$('#stats-bar').innerHTML='<span>共 0 条</span>';$('#current-version-name').textContent=state.currentProject.name;}
    renderProjects();showToast('版本已删除');
  }catch(err){showToast(err.message,'error');}
}

function columnSortCompare(a,b){
  return (Number(a.sort_order)||0)-(Number(b.sort_order)||0)||(Number(a.id)||0)-(Number(b.id)||0);
}

function formatAggregateDisplay(key){
  const value=state.columnTotals[key]??'0';
  const unit=state.columnUnits[key]||'';
  return `${value}${unit?` ${unit}`:''}`;
}

function renderCurrentVersionName(){
  const target=$('#current-version-name');
  if(!target)return;
  if(!state.currentProject||!state.currentVersion){target.textContent='';return;}
  // 数字求和结果显示在对应列标题中，不拼接到版本标题，避免标题过长。
  target.textContent=`${state.currentProject.name} / ${state.currentVersion.version_name}`;
}

async function loadColumns(){
  if(!state.currentProject||!state.currentVersion){state.columns=[];return;}
  const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/columns`);state.columns=(res.data||[]).sort(columnSortCompare);
}
function visibleColumns(){return state.columns.filter(c=>c.is_visible);}

function updateAggregateColumnHeaders(){
  $$('#case-table thead th[data-key]').forEach(th=>{
    const column=state.columns.find(item=>String(item.key)===String(th.dataset.key));
    if(!column)return;
    const name=column.aggregate_type==='sum'
      ?`${column.name}（${formatAggregateDisplay(column.key)}）`
      :column.name;
    const title=th.querySelector('.col-title');
    if(title)title.textContent=name;
  });
}

async function loadCases(){
  if(!state.currentVersion)return;
  // 重新加载会重建表格 DOM。若当前仍有单击编辑中的输入框，先提交它，
  // 避免旧输入框被移除后再从空的 td.textContent 读取并覆盖原内容。
  const activeEdit=state.inlineEditing;
  if(activeEdit&&!activeEdit.finished&&activeEdit.editor?.isConnected){
    await commitInlineCellEdit(activeEdit,false);
  }
  const loadSerial=++state.casesLoadSerial;
  const projectId=state.currentProject.id;
  const versionId=state.currentVersion.id;
  const statusQuery=state.statusFilters.join(',');
  const res=await api(`/api/projects/${projectId}/versions/${versionId}/cases?page=${state.page}&page_size=${state.pageSize}&keyword=${encodeURIComponent(state.keyword)}&status=${encodeURIComponent(statusQuery)}`);
  // 状态更新、筛选和刷新可能同时发起请求；只接受最后一次请求，
  // 防止较早返回的旧筛选结果覆盖当前页面。
  if(loadSerial!==state.casesLoadSerial||state.currentProject?.id!==projectId||state.currentVersion?.id!==versionId)return;
  state.cases=res.data.cases||[];state.total=res.data.total||0;state.columns=res.data.columns||state.columns;state.merges=res.data.merges||[];renderTable();renderPagination();
}

async function loadStats(){
  if(!state.currentVersion)return;
  const loadSerial=++state.statsLoadSerial;
  const projectId=state.currentProject.id;
  const versionId=state.currentVersion.id;
  const res=await api(`/api/projects/${projectId}/versions/${versionId}/stats`);
  if(loadSerial!==state.statsLoadSerial||state.currentProject?.id!==projectId||state.currentVersion?.id!==versionId)return;
  const {total,stats}=res.data;
  state.columnTotals=Object.fromEntries((res.data.numeric_totals||[]).map(item=>[item.key,item.value]));
  state.columnUnits=Object.fromEntries((res.data.numeric_totals||[]).map(item=>[item.key,item.unit||'']));
  renderCurrentVersionName();
  const numericTotals=state.columns.filter(column=>column.is_visible&&column.aggregate_type==='sum').map(column=>`<div class="stat-item numeric-total"><span class="stat-dot"></span><span>${escapeHtml(column.name)}合计: ${escapeHtml(formatAggregateDisplay(column.key))}</span></div>`).join('');
  $('#stats-bar').innerHTML=`<span>共 ${total} 条</span>`+STATUS_LIST.map(s=>`<div class="stat-item"><span class="stat-dot" style="background:${STATUS_COLORS[s]}"></span><span>${s}: ${stats[s].count} (${stats[s].percent}%)</span></div>`).join('')+numericTotals;
  // 统计请求可能早于用例请求返回。这里只更新统计相关内容，
  // 不重绘用例表，避免旧状态短暂覆盖用户刚选择的新执行结果。
  updateAggregateColumnHeaders();
  await loadSummary();
}

async function refreshCurrentVersionCases(){
  if(!state.currentProject||!state.currentVersion){
    showToast('请先选择项目版本','error');
    return;
  }
  const button=$('#btn-refresh-cases');
  if(button)button.disabled=true;
  try{
    // 不重置搜索、筛选和分页，只重新读取当前项目当前版本的数据。
    await Promise.all([loadCases(),loadStats()]);
    showToast('当前版本用例已刷新');
  }catch(err){
    showToast(err.message,'error');
  }finally{
    if(button)button.disabled=false;
  }
}

async function loadSummary(){
  if(!state.currentVersion)return;
  try{
    const fieldKey=state.summaryFieldKey||'remark';
    const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/summary?field_key=${encodeURIComponent(fieldKey)}`);
    const d=res.data;
    state.summaryFieldKey=d.summary_field_key||fieldKey;
    const btn=$('#btn-summary');
    btn.disabled=!d.can_summarize;
    btn.dataset.summary=JSON.stringify(d);
  }catch(err){console.error(err);}
}

function renderSummaryModal(d){
  const btn=$('#btn-summary');
  if(btn.disabled)return;
  const body=$('#summary-body');
  const renderProblems=(title,items)=>`
    <div class="summary-section">
      <h4>${title}（${items.length}）</h4>
      ${items.length?'<ol>'+items.map(item=>{
        const caseNo=escapeHtml(item.case_no||'未编号');
        const caseTitle=escapeHtml(item.title||'未命名用例');
        const images=state.summaryShowImages?(item.images||[]):[];
        const imageHtml=images.length?`<div class="summary-images">${images.map(image=>`<img src="${escapeHtml(image.content_url||'')}" alt="图片" title="点击放大" onclick="openLightbox(this.src)">`).join('')}</div>`:'';
        return `<li><span class="summary-case-title">${caseTitle}</span>：<span class="summary-reason">${escapeHtml(item.reason||'未填写问题描述').replace(/\r?\n/g,'<br>')}</span>（${caseNo}）${imageHtml}</li>`;
      }).join('')+'</ol>':'<p class="empty">无</p>'}
    </div>`;
  const fields=(d.summary_fields||state.columns||[]).map(field=>`<option value="${escapeHtml(field.key)}" ${field.key===state.summaryFieldKey?'selected':''}>${escapeHtml(field.name)}</option>`).join('');
  body.innerHTML=`
    <div class="summary-options">
      <label>总结字段 <select id="summary-field-select">${fields}</select></label>
      <label class="summary-image-toggle"><input type="checkbox" id="summary-show-images" ${state.summaryShowImages?'checked':''}>显示图片</label>
      <span class="summary-option-tip">默认不显示图片</span>
      <button type="button" class="secondary" id="summary-export-html">导出 HTML</button>
      <button type="button" class="secondary" id="summary-export-image">导出图片</button>
    </div>
    <div class="summary-cards">
      <div class="summary-card"><div class="summary-num">${d.total}</div><div>总用例</div></div>
      <div class="summary-card"><div class="summary-num">${d.completed??d.executed??0}</div><div>完成</div></div>
      <div class="summary-card completion"><div class="summary-num">${d.completed_percent??0}%</div><div>完成率</div></div>
      <div class="summary-card"><div class="summary-num">${d.unexecuted||0}</div><div>未执行</div></div>
      <div class="summary-card success"><div class="summary-num">${d.success}</div><div>成功</div></div>
      <div class="summary-card fail"><div class="summary-num">${d.fail}</div><div>失败</div></div>
      <div class="summary-card block"><div class="summary-num">${d.block}</div><div>阻塞</div></div>
      <div class="summary-card skip"><div class="summary-num">${d.skip}</div><div>跳过</div></div>
    </div>
    ${renderProblems('失败问题',d.fail_reasons||[])}
    ${renderProblems('阻塞问题',d.block_reasons||[])}
    ${renderProblems('跳过问题',d.skip_reasons||[])}
  `;
  $('#summary-field-select')?.addEventListener('change',async event=>{
    state.summaryFieldKey=event.target.value;
    await loadSummary(state.summaryFieldKey);
    const next=JSON.parse($('#btn-summary').dataset.summary||'{}');
    renderSummaryModal(next);
  });
  $('#summary-show-images')?.addEventListener('change',event=>{
    state.summaryShowImages=event.target.checked;
    renderSummaryModal(d);
  });
  $('#summary-export-html')?.addEventListener('click',()=>downloadSummary('html'));
  $('#summary-export-image')?.addEventListener('click',()=>downloadSummary('png'));
}

function openSummaryModal(){
  const btn=$('#btn-summary');
  if(btn.disabled)return;
  renderSummaryModal(JSON.parse(btn.dataset.summary||'{}'));
  openModal('#summary-modal');
}

function bindRowHeightResize(){
  if(!state.editMode)return;
  $$('#case-table tbody tr[data-case-id]').forEach(tr=>{
    const cell=tr.querySelector('td.cell-text')||tr.querySelector('td:not(.select-cell):not(.actions-cell)');
    if(!cell||cell.querySelector('.row-height-handle'))return;
    const handle=document.createElement('span');handle.className='row-height-handle';handle.title='拖动调整行高';cell.appendChild(handle);
    handle.addEventListener('mousedown',event=>{
      event.preventDefault();event.stopPropagation();
      const startY=event.clientY;const startHeight=tr.getBoundingClientRect().height;
      const onMove=moveEvent=>{
        applyCaseRowHeightStyle(tr,Math.round(startHeight+moveEvent.clientY-startY));
      };
      const onUp=async()=>{
        document.removeEventListener('mousemove',onMove);document.removeEventListener('mouseup',onUp);
        const height=applyCaseRowHeightStyle(tr,Math.round(tr.getBoundingClientRect().height));
        const caseId=Number(tr.dataset.caseId);const tc=state.cases.find(item=>Number(item.id)===caseId);if(tc)tc.row_height=height;
        try{await api(`/api/cases/${caseId}`,{method:'PUT',body:JSON.stringify({row_height:height})});showToast(`行高已调整为 ${height}px`);}
        catch(err){showToast(err.message,'error');}
      };
      document.addEventListener('mousemove',onMove);document.addEventListener('mouseup',onUp,{once:true});
    });
  });
}

function applyCaseRowHeightStyle(tr,height){
  const normalized=Math.max(24,Math.min(360,Number(height)||36));
  tr.style.height=`${normalized}px`;
  // 图片预览高度跟随行高，避免原图把表格行撑成竖屏长图。
  tr.style.setProperty('--case-image-max-height',`${Math.max(24,normalized-18)}px`);
  return normalized;
}

function renderTable(){
  if(state.quickAddRow){renderQuickAddRows();return;}
  const cols=visibleColumns();const thead=$('#case-table thead');const tbody=$('#case-table tbody');
  const hasVersion=Boolean(state.currentVersion);
  const showActions=state.editMode&&hasVersion;
  const showSelection=state.editMode&&hasVersion;
  if(!hasVersion){
    thead.innerHTML='';
    tbody.innerHTML='<tr><td class="empty-state no-version-state">该项目暂无版本，请先新建版本</td></tr>';
    updateSelectedCaseCount();
    return;
  }
  const ths=cols.map(c=>{
    const headerName=c.aggregate_type==='sum'
      ?`${c.name}（${formatAggregateDisplay(c.key)}）`
      :c.name;
    return `<th data-key="${escapeHtml(c.key)}" data-id="${c.id}" style="width:${c.width}px" title="${c.aggregate_type==='sum'?'数字求和列，排序优先级最低':''}"><span class="col-title">${escapeHtml(headerName)}</span>${state.editMode?'<div class="resize-handle"></div>':''}</th>`;
  }).join('');
  thead.innerHTML=`<tr>${showSelection?'<th class="select-header" style="width:44px"><input type="checkbox" id="select-all-cases" title="全选当前页" onchange="toggleAllCases(this.checked)"></th>':''}${ths}${showActions?renderActionsHeader():''}</tr>`;
  bindColumnContextMenu();
  tbody.innerHTML='';
  if(!state.cases.length){
    tbody.innerHTML=`<tr><td colspan="${cols.length+(showActions?1:0)+(showSelection?1:0)}" class="empty-state">暂无数据</td></tr>`;
    // 批量删除最后一页/全部用例后没有复选框可供统计，仍需主动清零按钮文案，
    // 否则会残留“批量删除（85）”这样的旧数量。
    updateSelectedCaseCount();
    return;
  }
  const pageIds=state.cases.map(tc=>tc.id);
  state.cases.forEach(tc=>{
    const cells=cols.map(c=>renderCell(c,tc,pageIds));
    const tr=document.createElement('tr');
    tr.dataset.caseId=tc.id;
    applyCaseRowHeightStyle(tr,Number(tc.row_height)||36);
    tr.addEventListener('mousedown',()=>{state.formatRowCaseId=tc.id;});
    tr.addEventListener('contextmenu',showRowContextMenu);
    tr.innerHTML=`${showSelection?`<td class="select-cell"><input type="checkbox" class="case-select" value="${tc.id}" onchange="updateSelectedCaseCount()" onclick="event.stopPropagation()" title="选择用例"></td>`:''}${cells.join('')}${showActions?renderActionsCell(tc.id):''}`;
    tbody.appendChild(tr);
  });
  bindRowHeightResize();
  if(state.editMode)bindColumnResize();
  updateSelectedCaseCount();
}

function toggleAllCases(checked){
  $$('.case-select').forEach(box=>{box.checked=checked;});
  updateSelectedCaseCount();
}

function updateSelectedCaseCount(){
  const selected=$$('.case-select:checked').length;
  const button=$('#btn-batch-delete');
  if(button)button.textContent=selected?`批量删除（${selected}）`:'批量删除';
  const all=$$('.case-select').length>0&&selected===$$('.case-select').length;
  const header=$('#select-all-cases');
  if(header)header.checked=all;
}

async function deleteSelectedCases(){
  if(!state.editMode)return;
  const ids=Array.from($$('.case-select:checked')).map(box=>parseInt(box.value,10)).filter(Number.isInteger);
  if(!ids.length){showToast('请先选择要删除的用例','error');return;}
  if(!confirm(`确定删除选中的 ${ids.length} 条用例吗？关联图片和合并关系也会删除，此操作不可恢复。`))return;
  try{
    const res=await api('/api/cases/batch-delete',{method:'POST',body:JSON.stringify({case_ids:ids})});
    await Promise.all([loadCases(),loadStats()]);
    showToast(`已删除 ${res.data?.deleted??ids.length} 条用例`);
  }catch(err){showToast(err.message,'error');}
}

function renderRowActions(id){
  return `<button class="secondary" onclick="editCase(${id})">编辑</button><button class="danger" onclick="deleteCase(${id})">删除</button>`;
}

function renderActionsHeader(){
  const collapsed=state.actionsCollapsed;
  return `<th class="actions-header ${collapsed?'actions-collapsed':''}"><div class="actions-header-content"><span class="actions-header-title">操作</span><button type="button" class="actions-toggle" onclick="toggleActionsColumn(event)" title="${collapsed?'展开操作列':'收缩操作列'}">${collapsed?'展开':'收缩'}</button></div></th>`;
}

function renderActionsCell(id){
  return `<td class="actions-cell ${state.actionsCollapsed?'actions-collapsed':''}">${state.actionsCollapsed?'':renderRowActions(id)}</td>`;
}

function toggleActionsColumn(event){
  event?.stopPropagation();
  if(state.quickAddRow){showToast('请先保存或取消新增行','error');return;}
  state.actionsCollapsed=!state.actionsCollapsed;
  renderTable();
}

function showRowContextMenu(e){
  if(!state.editMode)return;
  e.preventDefault();
  const caseId=e.currentTarget.dataset.caseId;
  // 用例编号列不参与合并。记录实际右键所在的列，避免目标用例的标题、模块等
  // 其他列处于合并区域时，把“按序号插入”错误地推到合并块末尾。
  const clickedColumn=e.target.closest('td[data-key]')?.dataset.key||'';
  const insertColumnKey=clickedColumn==='case_no'?'case_no':'';
  // 这里只允许传递两个固定值，使用 HTML 属性内的单引号，避免把
  // JSON.stringify 产生的双引号嵌入 onclick 双引号后截断点击脚本。
  const insertColumnArg=insertColumnKey==='case_no'?"'case_no'":"''";
  removeContextMenu();
  const menu=document.createElement('div');menu.id='row-context-menu';menu.className='context-menu';
  menu.style.left=e.pageX+'px';menu.style.top=e.pageY+'px';
  menu.innerHTML=`
    <div onclick="insertQuickRow(${caseId},'above',1,${insertColumnArg});removeContextMenu();">在上方插入行</div>
    <div onclick="insertQuickRow(${caseId},'below',1,${insertColumnArg});removeContextMenu();">在下方插入行</div>
    <div onclick="insertQuickRowPrompt(${caseId},'above',${insertColumnArg});removeContextMenu();">在上方插入多行</div>
    <div onclick="insertQuickRowPrompt(${caseId},'below',${insertColumnArg});removeContextMenu();">在下方插入多行</div>
  `;
  document.body.appendChild(menu);
  document.addEventListener('click',removeContextMenu,{once:true});
}

function removeContextMenu(){
  ['row-context-menu','column-context-menu'].forEach(id=>{const menu=$(`#${id}`);if(menu)menu.remove();});
}

function bindColumnContextMenu(){
  if(!state.editMode)return;
  $('#case-table thead')?.querySelectorAll('th[data-key]').forEach(th=>{
    th.addEventListener('contextmenu',e=>showColumnContextMenu(e,th.dataset.key,Number(th.dataset.id)));
  });
}

function showColumnContextMenu(e,key,columnId){
  if(!state.editMode)return;
  e.preventDefault();
  removeContextMenu();
  const column=state.columns.find(col=>col.id===columnId||col.key===key);
  if(!column)return;
  const menu=document.createElement('div');
  menu.id='column-context-menu';menu.className='context-menu';
  menu.innerHTML='<div data-align="left">整列靠左</div><div data-align="center">整列居中</div><div data-align="right">整列靠右</div>';
  menu.querySelectorAll('[data-align]').forEach(item=>{
    item.addEventListener('click',()=>applyColumnAlignment(column.id,item.dataset.align));
  });
  document.body.appendChild(menu);
  const gap=6;
  menu.style.left=`${Math.min(e.pageX,window.scrollX+window.innerWidth-menu.offsetWidth-gap)}px`;
  menu.style.top=`${Math.min(e.pageY,window.scrollY+window.innerHeight-menu.offsetHeight-gap)}px`;
  document.addEventListener('click',removeContextMenu,{once:true});
}

async function applyColumnAlignment(columnId,alignment){
  if(!['left','center','right'].includes(alignment))return;
  const column=state.columns.find(col=>col.id===columnId);
  if(!column)return;
  try{
    await api(`/api/columns/${columnId}`,{method:'PUT',body:JSON.stringify({text_align:alignment})});
    column.text_align=alignment;
    removeContextMenu();
    renderTable();
    showToast(`“${column.name}”已整列${alignment==='left'?'靠左':alignment==='center'?'居中':'靠右'}`);
  }catch(err){showToast(err.message,'error');}
}

function findMerge(c,caseId){return state.merges.find(merge=>merge.column_key===c.key&&(merge.case_ids||[]).includes(caseId));}

function activeVersionScope(){
  const version=state.currentVersion;
  const project=state.currentProject;
  if(!version||!project||Number(version.project_id)!==Number(project.id))return null;
  return {projectId:Number(version.project_id),versionId:Number(version.id)};
}

function columnTextAlign(c){return ['left','center','right'].includes(c?.text_align)?c.text_align:'left';}
function getCaseColumnValue(tc,col){
  if(!tc||!col)return '';
  if(col.is_system)return tc[col.key]??'';
  return tc[col.key]??tc.custom_fields?.[col.key]??'';
}

function renderMergedContinuationCell(c,tc){
  const selected=state.mergeAnchor?.key===c.key&&state.mergeAnchor?.caseId===tc.id;
  const selectAttr=state.mergeMode
    ? ` onclick="selectMergeCell(event,'${escapeHtml(c.key)}',${tc.id})"`
    : '';
  return `<td data-key="${escapeHtml(c.key)}" data-case="${tc.id}" class="merged-cell merge-continuation ${state.mergeMode?'merge-selectable ':''}${selected?'merge-anchor ':''}" style="text-align:${columnTextAlign(c)};vertical-align:middle"${selectAttr} title=""></td>`;
}

function getMergedCellValue(c,merge){
  const values=(merge.case_ids||[]).map(caseId=>{
    const member=state.cases.find(item=>item.id===caseId);
    if(member)return getCaseColumnValue(member,c);
    return merge.values?.[String(caseId)]??merge.values?.[caseId]??'';
  }).filter(value=>value!==null&&value!==undefined&&String(value).trim()!=='');
  if(!values.length)return '';
  // 纯文本使用换行；混合富文本时，先转义普通文本再插入换行，避免把
  // 用户输入的 <、> 当成 HTML，同时保留图片和删除线等已有富文本。
  if(values.some(value=>isRichTextValue(value))){
    return values.map(value=>isRichTextValue(value)?String(value):escapeHtml(value)).join('<br>');
  }
  return values.join('\n');
}

function getMergedEditContext(c,caseId){
  const merge=findMerge(c,caseId);
  return merge&&merge.case_ids?.[0]===caseId?merge:null;
}

function splitMergedValueForSave(value,merge){
  const ids=merge?.case_ids||[];
  if(ids.length<=1)return [value??''];
  const raw=(value??'').toString();
  let parts=[];
  if(isRichTextValue(raw)){
    const box=document.createElement('div');
    box.innerHTML=raw;
    const blocks=Array.from(box.children);
    if(blocks.length===ids.length)parts=blocks.map(block=>block.outerHTML);
    if(parts.length!==ids.length)parts=raw.split(/<br\s*\/?>/i);
  }else{
    parts=raw.replace(/\r\n/g,'\n').split('\n');
  }
  // 简单的一行对应一条用例时，按原顺序分别保存，取消合并后仍能恢复。
  // 用户重新编辑成复杂富文本时无法可靠推断行边界，则完整内容留在首行，
  // 其他成员清空，避免重新渲染时重复拼接。
  return parts.length===ids.length
    ? parts
    : [raw,...Array(ids.length-1).fill('')];
}

async function saveMergedCellValues(caseId,col,merge,value){
  const ids=merge?.case_ids||[];
  const parts=splitMergedValueForSave(value,merge);
  for(let index=0;index<ids.length;index++){
    const memberId=ids[index];
    const memberValue=parts[index]??'';
    const payload=col.is_system?{[col.key]:memberValue}:{custom_fields:{[col.key]:memberValue}};
    await api(`/api/cases/${memberId}`,{method:'PUT',body:JSON.stringify(payload)});
  }
}

function renderCell(c,tc,pageIds=[],ignoreMerge=false){
  // 用例编号按标题合并组显示：同一条逻辑用例只显示一个编号，
  // 但不创建 case_no 合并记录，避免编号数据和展示合并相互影响。
  if(!ignoreMerge&&c.key==='case_no'){
    const logicalMerge=findMerge({key:'title'},tc.id);
    if(logicalMerge){
      const mergeIds=logicalMerge.case_ids||[];
      const anchorId=mergeIds[0];
      const visibleIds=mergeIds.filter(id=>pageIds.includes(id));
      if(tc.id!==anchorId){
        return pageIds.includes(anchorId)?'':renderMergedContinuationCell(c,tc);
      }
      if(visibleIds.length>1)return renderCellContent(c,tc,visibleIds.length,getCaseColumnValue(tc,c));
    }
  }
  const merge=ignoreMerge?null:findMerge(c,tc.id);
  if(merge){
    const mergeIds=merge.case_ids||[];
    const anchorId=mergeIds[0];
    const visibleIds=mergeIds.filter(id=>pageIds.includes(id));
    if(tc.id!==anchorId){
      // 合并起始行在上一页或被筛选掉时，仍需输出占位 td，避免整行列数减少。
      // 起始行在当前页时则由 rowspan 覆盖当前页内的后续成员行。
      return pageIds.includes(anchorId)?'':renderMergedContinuationCell(c,tc);
    }
    if(visibleIds.length>1)return renderCellContent(c,tc,visibleIds.length,getMergedCellValue(c,merge));
  }
  return renderCellContent(c,tc,1);
}

function renderCellContent(c,tc,rowspan=1,valueOverride){
  const selected=state.mergeAnchor?.key===c.key&&state.mergeAnchor?.caseId===tc.id;
  if(c.key==='status'){
    const selectAttr=state.mergeMode?` onclick="selectMergeCell(event,'${escapeHtml(c.key)}',${tc.id})"`:'';
    const status=normalizeStatus(tc.status);
    const displayStatus=STATUS_LIST.includes(status)?status:'未执行';
    const statusColor=STATUS_COLORS[displayStatus]||'#606266';
    const align=columnTextAlign(c);
    const readonlyAttr=state.currentUser?.can_write===true?'':' disabled';
    return `<td data-key="${escapeHtml(c.key)}" data-case="${tc.id}" class="${rowspan>1?'merged-cell ':''}${state.mergeMode?'merge-selectable ':''}${selected?'merge-anchor':''}" style="text-align:${align};vertical-align:middle"${rowspan>1?` rowspan="${rowspan}"`:''}${selectAttr}><select class="status-select status-${escapeHtml(displayStatus)}" style="color:${statusColor};text-align:${align}" onchange="updateStatus(${tc.id},this.value,this)"${readonlyAttr}>${STATUS_LIST.map(s=>`<option value="${escapeHtml(s)}" ${displayStatus===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select></td>`;
  }
  let val=valueOverride===undefined?getCaseColumnValue(tc,c):valueOverride;if(c.key==='custom_fields'&&valueOverride===undefined){const custom=tc.custom_fields||{};val=Object.values(custom).join(' ');}
  const isRich=isRichTextValue(val);
  const str=escapeHtml(isRich?richTextPlainText(val):val);
  const contentHtml=isRich?richTextHtml(val,columnTextAlign(c)):str.replace(/\n/g,'<br>');
  const mergeAttr=rowspan>1?` rowspan="${rowspan}"`:'';
  const mergeClass=rowspan>1?'merged-cell ':'';
  const multiline=c.key==='steps'||c.key==='remark'||c.key==='precondition'||c.key==='expected_result'||!c.is_system;
  let interaction='';
  if(state.mergeMode){
    interaction=` onclick="selectMergeCell(event,'${escapeHtml(c.key)}',${tc.id})"`;
  }else if(state.editMode){
    interaction=` onclick="queueCellEdit(this,'${escapeHtml(c.key)}',${tc.id})" ondblclick="openCellEditorFromDoubleClick(event,this,'${escapeHtml(c.key)}',${tc.id})"`;
  }
  return `<td data-key="${escapeHtml(c.key)}" data-case="${tc.id}" class="${mergeClass}${state.mergeMode?'merge-selectable ':''}${selected?'merge-anchor ':''}cell-text ${multiline?'multiline':''} ${c.key==='remark'?'rich-cell':''}" style="text-align:${columnTextAlign(c)}"${mergeAttr}${interaction} title="${str}">${contentHtml}</td>`;
}

function toggleMergeMode(mode){
  state.mergeMode=state.mergeMode===mode?false:mode;state.mergeAnchor=null;renderTable();
  showToast(state.mergeMode?(mode==='merge'?'请选择同一列的起止单元格':'请选择要取消合并的单元格'):'已退出单元格操作');
}
async function selectMergeCell(event,key,caseId){
  event.stopPropagation();
  const scope=activeVersionScope();
  if(!scope){showToast('项目与版本已变化，请重新选择版本','error');return;}
  if(state.mergeMode==='unmerge'){
    const merge=findMerge({key},caseId);if(!merge){showToast('该单元格未合并','error');return;}
    try{await api(`/api/merges/${merge.id}`,{method:'DELETE'});state.mergeAnchor=null;await loadCases();showToast('已取消合并');}catch(err){showToast(err.message,'error');}
    return;
  }
  if(!state.mergeAnchor){state.mergeAnchor={key,caseId};renderTable();return;}
  if(state.mergeAnchor.key!==key){showToast('请选择同一列的单元格','error');return;}
  const ids=state.cases.map(tc=>tc.id);const start=ids.indexOf(state.mergeAnchor.caseId);const end=ids.indexOf(caseId);
  if(start<0||end<0){showToast('请选择当前页面中的单元格','error');return;}
  const [from,to]=start<end?[start,end]:[end,start];
  if(to-from<1){showToast('至少选择两个连续单元格','error');return;}
  try{
    await api(`/api/projects/${scope.projectId}/versions/${scope.versionId}/merges`,{method:'POST',body:JSON.stringify({column_key:key,case_ids:ids.slice(from,to+1)})});
    state.mergeMode=false;state.mergeAnchor=null;await loadCases();showToast('单元格合并成功');
  }catch(err){showToast(err.message,'error');}
}

function formatToolbarHtml(){
  // direction:rtl 时 DOM 第一个控件位于最右侧，因此重置按钮固定放在最前面。
  return `<div id="editor-format-toolbar" class="editor-format-toolbar" role="toolbar" aria-label="用例格式工具"><button type="button" id="format-reset" title="重置当前版本格式">↺</button><button type="button" id="apply-row-height" title="保存行高">应用</button><label class="format-row-height-control" title="设置当前行或选中行的行高"><span>行高</span><input id="format-row-height" type="number" min="24" max="360" step="1" value="36" aria-label="行高"><span>px</span></label><button type="button" id="format-painter" title="格式刷">🖌</button><button type="button" data-format="right" title="靠右">右</button><button type="button" data-format="center" title="居中">中</button><button type="button" data-format="left" title="靠左">左</button><span class="format-toolbar-divider"></span><button type="button" data-format="strike" title="删除线"><span class="strike-icon">S</span></button><button type="button" data-format="underline" title="下划线"><u>U</u></button><button type="button" data-format="italic" title="斜体"><i>I</i></button><button type="button" data-format="bold" title="加粗"><b>B</b></button><label class="format-size-control" title="字体大小"><span>字号</span><select id="format-font-size" aria-label="字体大小"><option value="12">12</option><option value="14" selected>14</option><option value="16">16</option><option value="18">18</option><option value="20">20</option><option value="24">24</option><option value="28">28</option></select></label><label class="format-color-control" title="字体颜色"><span>字色</span><input id="format-font-color" type="color" value="#303133" aria-label="字体颜色"></label><span class="format-toolbar-label">格式</span></div>`;
}

function renderPagination(){
  const tp=Math.max(1,Math.ceil(state.total/state.pageSize));
  const toolbarHtml=state.editMode&&state.currentVersion?formatToolbarHtml():'';
  $('#pagination').innerHTML=`${toolbarHtml}<div class="pagination-controls"><span>共 ${state.total} 条</span><select onchange="changePageSize(this.value)"><option value="20" ${state.pageSize===20?'selected':''}>20 条/页</option><option value="50" ${state.pageSize===50?'selected':''}>50 条/页</option><option value="100" ${state.pageSize===100?'selected':''}>100 条/页</option><option value="200" ${state.pageSize===200?'selected':''}>200 条/页</option><option value="300" ${state.pageSize===300?'selected':''}>300 条/页</option></select><button ${state.page<=1?'disabled':''} onclick="changePage(${state.page-1})">上一页</button><span>${state.page} / ${tp}</span><button ${state.page>=tp?'disabled':''} onclick="changePage(${state.page+1})">下一页</button></div>`;
  bindFormatToolbar();
  updateEditModeUI();
}
function changePage(p){const tp=Math.max(1,Math.ceil(state.total/state.pageSize));if(p<1||p>tp)return;state.page=p;loadCases();}
function changePageSize(s){state.pageSize=parseInt(s);state.page=1;loadCases();}

function isRichTextValue(value){return /<(?:img|br|div|p|span|s|strike|del|font|b|strong|i|em|u)\b/i.test((value??'').toString());}
function normalizeRichEditorValue(value){
  const raw=(value??'').toString();
  if(!raw.trim())return '';
  const box=document.createElement('div');
  box.innerHTML=raw;
  const hasImage=Boolean(box.querySelector('img'));
  const text=(box.textContent||'').replace(/\u00a0/g,' ').replace(/\u200b/g,'').trim();
  // 浏览器在 contenteditable 全选删除后可能留下 <br>、空 span 或空 div，
  // 这些节点只用于维持光标位置，不能作为实际内容保存。
  if(!hasImage&&!text)return '';
  return raw;
}
function richTextHtml(value,forcedAlign=null){
  const raw=(value??'').toString();
  if(!isRichTextValue(raw))return escapeHtml(raw).replace(/\r?\n/g,'<br>');
  const template=document.createElement('template');
  template.innerHTML=raw;
  template.content.querySelectorAll('script,style,iframe,object,embed,link').forEach(node=>node.remove());
  template.content.querySelectorAll('*').forEach(node=>{
    Array.from(node.attributes).forEach(attr=>{
      if(attr.name.toLowerCase().startsWith('on'))node.removeAttribute(attr.name);
    });
    if(node.tagName==='IMG'){
      const src=node.getAttribute('src')||'';
      if(!src.startsWith('/api/images/'))node.remove();
      else{
        node.setAttribute('class','rich-content-image');
        node.setAttribute('alt',node.getAttribute('alt')||'图片');
      }
    }
  });
  // 部分 Excel 富文本会把每一行放在同一个 div 下的多个 span 中，
  // span 本身是行内元素，直接展示时会把原本的多行挤成一行。
  template.content.querySelectorAll('div,p').forEach(block=>{
    const children=Array.from(block.children);
    const onlySpans=children.length>1
      &&children.every(node=>node.tagName==='SPAN')
      &&Array.from(block.childNodes).every(node=>node.nodeType===1
        ||(node.nodeType===3&&!node.textContent.trim()));
    if(onlySpans)children.slice(0,-1).forEach(node=>node.after(document.createElement('br')));
    if(forcedAlign&&['DIV','P'].includes(block.tagName))block.style.textAlign=forcedAlign;
  });
  return template.innerHTML;
}
function richTextPlainText(value){
  const raw=(value??'').toString();
  if(!isRichTextValue(raw))return raw;
  const box=document.createElement('div');box.innerHTML=richTextHtml(raw);
  box.querySelectorAll('img').forEach(img=>img.replaceWith('[图片]'));
  return box.innerText||box.textContent||'';
}
function getEditorValue(editor){
  if(!editor)return '';
  if(editor.isContentEditable){
    const raw=editor.innerHTML;
    const value=editor.dataset.applyDefaultFormat==='true'&&editor.dataset.defaultFormatDirty==='true'&&raw.trim()
      ?applyDefaultMarkup(raw)
      :raw;
    return normalizeRichEditorValue(value);
  }
  return (editor.value??'').replace(/\r\n/g,'\n');
}

function applyDefaultMarkup(value){
  const defaults=activateFormatScope();
  if(defaults.color==='#303133'&&defaults.fontSize===14&&!defaults.bold&&!defaults.italic&&!defaults.underline&&!defaults.strike)return value;
  const box=document.createElement('div');box.innerHTML=value;
  const wrapper=document.createElement('span');
  wrapper.style.color=defaults.color;wrapper.style.fontSize=`${defaults.fontSize}px`;
  if(defaults.bold)wrapper.style.fontWeight='bold';
  if(defaults.italic)wrapper.style.fontStyle='italic';
  if(defaults.underline)wrapper.style.textDecoration='underline';
  if(defaults.strike)wrapper.style.textDecoration='line-through';
  while(box.firstChild)wrapper.appendChild(box.firstChild);
  box.appendChild(wrapper);return box.innerHTML;
}

function applyDefaultFormatToEditor(editor){
  if(!editor?.isContentEditable)return;
  const defaults=activateFormatScope();
  editor.style.color=defaults.color;editor.style.fontSize=`${defaults.fontSize}px`;
  editor.style.fontWeight=defaults.bold?'bold':'normal';editor.style.fontStyle=defaults.italic?'italic':'normal';
  editor.style.textDecoration=[defaults.underline?'underline':'',defaults.strike?'line-through':''].filter(Boolean).join(' ')||'none';
}
function setEditorValue(editor,value){
  if(!editor)return;
  if(editor.isContentEditable)editor.innerHTML=richTextHtml(value);
  else editor.value=(value??'').toString();
}
function embeddedImageIds(value){
  const ids=[];const box=document.createElement('div');box.innerHTML=richTextHtml(value);
  box.querySelectorAll('img[data-image-id]').forEach(img=>{const id=Number(img.dataset.imageId);if(Number.isInteger(id)&&id>0)ids.push(id);});
  return [...new Set(ids)];
}
async function deleteImageRecords(ids){
  for(const id of [...new Set(ids||[])]){
    try{await api(`/api/images/${id}`,{method:'DELETE'});}catch(err){console.warn('删除图片记录失败',id,err);}
  }
}
async function cleanupRemovedEmbeddedImages(caseId,oldValue,newValue,extraIds=[]){
  if(!caseId)return;
  const oldIds=embeddedImageIds(oldValue);const newIds=new Set(embeddedImageIds(newValue));
  const removed=oldIds.filter(id=>!newIds.has(id));
  const extra=(extraIds||[]).filter(id=>!newIds.has(id));
  await deleteImageRecords([...new Set([...removed,...extra])]);
}

function getEditableCellValue(td){
  const editor=td.querySelector('.inline-cell-editor');
  return editor?getEditorValue(editor):(td.innerText||td.textContent||'').replace(/\r\n/g,'\n');
}

function clearPendingCellClick(){
  if(pendingCellClick?.timer)clearTimeout(pendingCellClick.timer);
  pendingCellClick=null;
}

// 单击和双击都会先触发 click。稍微延迟单击动作，双击到来时取消单击，
// 避免“刚进入直接编辑又被双击弹窗/失焦取消”的竞争问题。
function queueCellEdit(td,key,caseId){
  if(!state.editMode||state.mergeMode)return;
  state.formatRowCaseId=caseId;
  if(pendingCellClick?.td===td)return;
  clearPendingCellClick();
  const pending={td,key,caseId,timer:null};
  pending.timer=setTimeout(()=>{
    if(pendingCellClick!==pending)return;
    pendingCellClick=null;
    beginCellEdit(td,key,caseId);
  },260);
  pendingCellClick=pending;
}

function openCellEditorFromDoubleClick(event,td,key,caseId){
  if(!state.editMode||state.mergeMode)return;
  event?.preventDefault();
  event?.stopPropagation();
  clearPendingCellClick();
  startInlineEdit(td,key,caseId);
}

function beginCellEdit(td,key,caseId){
  if(!state.editMode||state.mergeMode)return;
  const tc=state.cases.find(c=>c.id===caseId);if(!tc)return;
  const col=state.columns.find(c=>c.key===key);if(!col)return;
  if(state.inlineEditing?.td===td){td.focus();return;}
  if(state.inlineEditing)void commitInlineCellEdit(state.inlineEditing);

  const merge=getMergedEditContext(col,caseId);
  const oldVal=(merge?getMergedCellValue(col,merge):getCaseColumnValue(tc,col)).toString();
  const editing={td,key,caseId,col,merge,oldVal,lastValue:oldVal,originalHtml:td.innerHTML,originalTitle:td.title,finished:false,uploadedImageIds:[]};
  state.inlineEditing=editing;
  td.classList.add('cell-editing');
  td.removeAttribute('title');
  const multiline=['steps','remark','precondition','expected_result'].includes(key)||!col.is_system;
  const richEditor=true;
  const editor=document.createElement(richEditor?'div':(multiline?'textarea':'input'));
  editor.className='inline-cell-editor';
  if(richEditor){editor.contentEditable='true';editor.classList.add('rich-editor');editor.dataset.applyDefaultFormat='true';setEditorValue(editor,oldVal);applyDefaultFormatToEditor(editor);editor.addEventListener('input',()=>{editing.lastValue=getEditorValue(editor);editor.dataset.defaultFormatDirty='true';});}
  else editor.value=oldVal;
  if(multiline){editor.rows=Math.max(3,Math.min(8,oldVal.split('\n').length+1));}
  td.textContent='';
  td.appendChild(editor);
  editing.editor=editor;
  editor.onblur=()=>{
    // 选择分页栏格式工具时，编辑器会短暂失焦；等工具执行完再提交，
    // 否则会出现“点击字号/颜色后格式还没应用，单元格就先保存”的竞态。
    setTimeout(()=>{
      if(document.activeElement?.closest?.('#editor-format-toolbar'))return;
      void commitInlineCellEdit(editing);
    },0);
  };
  editor.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();cancelInlineCellEdit(editing);return;}
    if(e.key==='Enter'&&(!multiline||e.ctrlKey)){
      e.preventDefault();void commitInlineCellEdit(editing);
    }
  };
  editor.focus();
  // 单击进入编辑时只放置普通光标，不自动全选内容。
  // 这样选中文字工具条只会在用户主动产生选区后显示。
  if(editor.isContentEditable){
    const range=document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection=window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }else if(typeof editor.select==='function'){
    editor.setSelectionRange(editor.value.length,editor.value.length);
  }
}

async function commitInlineCellEdit(editing,reload=true){
  if(!editing||editing.finished)return;
  editing.finished=true;
  const {td,key,caseId,col,oldVal}=editing;
  // 编辑器可能已因列表刷新而脱离 DOM；此时只能使用 input 事件缓存的
  // 最后真实值，不能用已清空的 td.textContent 作为待保存内容。
  const value=editing.editor?.isConnected
    ? getEditorValue(editing.editor)
    : (editing.lastValue??oldVal);
  td.classList.remove('cell-editing');
  if(editing.editor){editing.editor.onblur=null;editing.editor.onkeydown=null;}
  if(state.inlineEditing===editing)state.inlineEditing=null;
  if(value===oldVal){
    if(td.isConnected){td.innerHTML=editing.originalHtml;td.title=editing.originalTitle;}
    return;
  }
  try{
    if(editing.merge)await saveMergedCellValues(caseId,col,editing.merge,value);
    else{
      const payload=col.is_system?{[key]:value}:{custom_fields:{[key]:value}};
      await api(`/api/cases/${caseId}`,{method:'PUT',body:JSON.stringify(payload)});
    }
    if(key==='remark')await cleanupRemovedEmbeddedImages(caseId,oldVal,value,editing.uploadedImageIds);
    if(reload)await loadCases();
  }catch(err){
    showToast(err.message,'error');
    if(state.inlineEditing===null)renderTable();
  }
}

function cancelInlineCellEdit(editing){
  if(!editing||editing.finished)return;
  editing.finished=true;
  editing.td.classList.remove('cell-editing');
  editing.td.innerHTML=editing.originalHtml;
  editing.td.title=editing.originalTitle;
  if(editing.editor){editing.editor.onblur=null;editing.editor.onkeydown=null;}
  if(editing.uploadedImageIds?.length)void deleteImageRecords(editing.uploadedImageIds);
  if(state.inlineEditing===editing)state.inlineEditing=null;
}

function startInlineEdit(td,key,caseId){
  if(!state.editMode)return;
  const tc=state.cases.find(c=>c.id===caseId);if(!tc)return;
  const col=state.columns.find(c=>c.key===key);if(!col)return;
  let valueOverride=null;
  if(state.inlineEditing?.td===td){
    const editing=state.inlineEditing;
    valueOverride=getEditableCellValue(td);
    cancelInlineCellEdit(editing);
  }else if(state.inlineEditing){
    void commitInlineCellEdit(state.inlineEditing);
  }
  const merge=getMergedEditContext(col,caseId);
  const oldVal=(valueOverride??(merge?getMergedCellValue(col,merge):getCaseColumnValue(tc,col))).toString();
  state.editingCell={caseId,key,col,merge,oldVal,uploadedImageIds:[]};
  $('#cell-editor-title').textContent=`编辑：${col.name}`;
  setEditorValue($('#cell-editor-input'),oldVal);
  state.caseImages=[];
  openModal('#cell-editor-modal');
  renderImageList();
  void loadCaseImages(caseId);
  setTimeout(()=>$('#cell-editor-input').focus(),0);
}

async function saveCellEditor(){
  const editing=state.editingCell;if(!editing)return;
  const value=getEditorValue($('#cell-editor-input'));
  if(value===editing.oldVal){closeCellEditor();return;}
  try{
    if(editing.merge)await saveMergedCellValues(editing.caseId,editing.col,editing.merge,value);
    else{
      const payload=editing.col.is_system?{[editing.key]:value}:{custom_fields:{[editing.key]:value}};
      await api(`/api/cases/${editing.caseId}`,{method:'PUT',body:JSON.stringify(payload)});
    }
    if(editing.key==='remark')await cleanupRemovedEmbeddedImages(editing.caseId,editing.oldVal,value,editing.uploadedImageIds);
    closeCellEditor(true);await Promise.all([loadCases(),loadStats()]);
  }catch(err){showToast(err.message,'error');}
}

function closeCellEditor(saved=false){
  if(!saved&&state.editingCell?.uploadedImageIds?.length)void deleteImageRecords(state.editingCell.uploadedImageIds);
  closeModal('#cell-editor-modal');state.editingCell=null;state.caseImages=[];renderImageList();
}

async function updateStatus(id,status,select){
  status=normalizeStatus(status);
  const localCase=state.cases.find(item=>Number(item.id)===Number(id));
  const previousStatus=localCase?.status;
  // 先更新本地列表，后续任何刷新都应立即使用新状态，避免“未执行”闪回。
  if(localCase)localCase.status=status;
  if(select){
    select.value=status;
    select.className=`status-select status-${escapeHtml(status)}`;
    select.style.color=STATUS_COLORS[status]||'#606266';
  }
  try{
    await api(`/api/cases/${id}`,{method:'PUT',body:JSON.stringify({status})});
    await Promise.all([loadCases(),loadStats()]);
  }catch(err){
    if(localCase&&previousStatus!==undefined)localCase.status=previousStatus;
    if(select){
      const rollback=normalizeStatus(previousStatus||'未执行');
      select.value=rollback;
      select.className=`status-select status-${escapeHtml(rollback)}`;
      select.style.color=STATUS_COLORS[rollback]||'#606266';
    }
    showToast(err.message,'error');
  }
}

async function resetCaseNumbers(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  if(!confirm('确定将当前版本的用例编号按列表顺序重置为 1、2、3……吗？'))return;
  try{
    const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/cases/reset-numbers`,{method:'POST'});
    await loadCases();
    showToast(`已重置 ${res.data?.reset||0} 条用例编号`);
  }catch(err){showToast(err.message,'error');}
}

function openCaseModal(tc=null){
  state.editingCase=tc;$('#case-modal-title').textContent=tc?'编辑用例':'新增用例';
  const body=$('#case-form-body');
  // 编辑字段严格跟随列表当前可见列，避免编辑弹窗出现表格中不存在的字段。
  const cols=visibleColumns();
  const fieldHtml=cols.map(c=>{
    const value=c.is_system?(tc?.[c.key]??''):(tc?.custom_fields?.[c.key]??'');
    let control;
    if(c.key==='status'){
      control=`<select class="case-form-field" data-key="${escapeHtml(c.key)}">${STATUS_LIST.map(s=>`<option value="${escapeHtml(s)}" ${value===s?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select>`;
    }else{
      control=`<div class="case-form-field rich-editor" data-key="${escapeHtml(c.key)}" data-apply-default-format="${tc?'false':'true'}" contenteditable="true" role="textbox" data-placeholder="可直接输入；选中文字后可使用格式工具">${richTextHtml(value)}</div>`;
    }
    return `<div class="form-group full" style="margin-bottom:14px"><label>${escapeHtml(c.name)}</label>${control}</div>`;
  }).join('');
  body.innerHTML=`${fieldHtml||'<p class="empty-state" style="padding:20px">当前没有可编辑的显示列</p>'}
    <div class="form-group full"><label>图片附件</label><input type="file" id="case-images" multiple accept="image/*"><button type="button" class="secondary paste-image-btn" onclick="pasteImageFromClipboard()">从剪贴板粘贴图片</button><p style="font-size:12px;color:#909399;margin-top:4px">也可以在输入框中按 Ctrl+V 粘贴；图片会先显示缩略图，保存后上传</p><div class="image-list" id="image-list"></div></div>`;
  body.querySelectorAll('.rich-editor').forEach(editor=>{
    applyDefaultFormatToEditor(editor);
    editor.addEventListener('input',()=>{editor.dataset.defaultFormatDirty='true';});
  });
  state.pendingImages=[];state.pendingEmbeddedImages=[];state.caseImages=[];state.caseModalUploadedImageIds=[];state.caseModalSaving=false;openModal('#case-modal');state.pasteTarget=tc?tc.id:null;
  $('#case-images').addEventListener('change',e=>{addPendingImages(Array.from(e.target.files||[]));e.target.value='';});
  if(tc)loadCaseImages(tc.id);else renderImageList();
}

function toggleStrike(){
  const selection=window.getSelection();
  const node=selection?.anchorNode;
  const element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  const target=element?.closest?.('[contenteditable="true"]')||document.activeElement?.closest?.('[contenteditable="true"]');
  if(!target)return;
  target.focus();
  document.execCommand('strikeThrough',false,null);
  target.dispatchEvent(new Event('input',{bubbles:true}));
}

let selectionFormatRange=null;

function getSelectedEditorContext(){
  if(!state.editMode)return null;
  const selection=window.getSelection();
  if(!selection||selection.rangeCount===0||selection.isCollapsed||!selection.toString().trim())return null;
  const anchor=selection.anchorNode;
  const focus=selection.focusNode;
  const anchorElement=anchor?.nodeType===Node.ELEMENT_NODE?anchor:anchor?.parentElement;
  const target=anchorElement?.closest?.('[contenteditable="true"]');
  if(!target||!focus||!target.contains(focus))return null;
  return {selection,target,range:selection.getRangeAt(0)};
}

function hideSelectionFormatMenu(){
  const menu=$('#selection-format-menu');
  if(menu){menu.style.display='none';menu.innerHTML='';}
  selectionFormatRange=null;
}

function showSelectionFormatMenu(){
  const context=getSelectedEditorContext();
  const menu=$('#selection-format-menu');
  if(!context||!menu){hideSelectionFormatMenu();return;}
  selectionFormatRange={target:context.target,range:context.range.cloneRange()};
  const quickColor=escapeHtml(state.quickFormatColor||'#f56c6c');
  menu.innerHTML='<button type="button" class="format-icon" data-format="left" title="靠左" aria-label="靠左"><span class="align-icon align-left"><i></i><i></i><i></i></span></button><button type="button" class="format-icon" data-format="center" title="居中" aria-label="居中"><span class="align-icon align-center"><i></i><i></i><i></i></span></button><button type="button" class="format-icon" data-format="right" title="靠右" aria-label="靠右"><span class="align-icon align-right"><i></i><i></i><i></i></span></button><button type="button" class="format-icon" data-format="strike" title="删除线" aria-label="删除线"><span class="strike-icon">S</span></button><button type="button" class="format-icon quick-red-format" data-format="quick-red" title="单击使用颜色，双击选择颜色" aria-label="字体颜色"><span class="color-dot" style="background:${quickColor}"></span></button>';
  menu.querySelectorAll('button').forEach(button=>{
    button.addEventListener('mousedown',e=>e.preventDefault());
    if(button.dataset.format==='quick-red'){
      let clickTimer=null;
      button.addEventListener('click',()=>{
        clearTimeout(clickTimer);
        clickTimer=setTimeout(()=>applySelectionFormat('quick-red',state.quickFormatColor||'#f56c6c'),220);
      });
      button.addEventListener('dblclick',event=>{
        event.preventDefault();
        clearTimeout(clickTimer);
        openQuickColorPicker();
      });
    }else button.addEventListener('click',()=>applySelectionFormat(button.dataset.format));
  });
  const rect=context.range.getBoundingClientRect();
  menu.style.display='flex';
  menu.style.visibility='hidden';
  requestAnimationFrame(()=>{
    const gap=8;
    let left=rect.left+(rect.width/2)-(menu.offsetWidth/2);
    let top=rect.top-menu.offsetHeight-gap;
    left=Math.max(gap,Math.min(left,window.innerWidth-menu.offsetWidth-gap));
    if(top<gap)top=Math.min(window.innerHeight-menu.offsetHeight-gap,rect.bottom+gap);
    menu.style.left=`${Math.max(gap,left)}px`;
    menu.style.top=`${Math.max(gap,top)}px`;
    menu.style.visibility='visible';
  });
}

function applySelectionFormat(format,value=null){
  const saved=selectionFormatRange;
  if(!saved||!saved.target?.isConnected){hideSelectionFormatMenu();return;}
  saved.target.focus();
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(saved.range);
  const command=format==='strike'?'strikeThrough':format==='quick-red'?'foreColor':`justify${format.charAt(0).toUpperCase()}${format.slice(1)}`;
  document.execCommand('styleWithCSS',false,true);
  if(format==='quick-red')document.execCommand('foreColor',false,value||'#f56c6c');
  else document.execCommand(command,false,null);
  saved.target.dispatchEvent(new Event('input',{bubbles:true}));
  hideSelectionFormatMenu();
}

function openQuickColorPicker(){
  if(!selectionFormatRange)return;
  const input=document.createElement('input');
  input.type='color';input.value=state.quickFormatColor||'#f56c6c';
  input.style.cssText='position:fixed;left:-100px;top:-100px;width:1px;height:1px;opacity:0;';
  const cleanup=()=>{if(input.isConnected)input.remove();};
  input.addEventListener('change',()=>{
    state.quickFormatColor=input.value;
    applySelectionFormat('quick-red',input.value);
    cleanup();
  });
  input.addEventListener('blur',()=>setTimeout(cleanup,0));
  document.body.appendChild(input);input.focus();input.click();
}

function savedFormatSelection(){
  if(selectionFormatRange?.target?.isConnected&&selectionFormatRange.target.isContentEditable){
    return {target:selectionFormatRange.target,range:selectionFormatRange.range.cloneRange()};
  }
  const context=getSelectedEditorContext();
  if(!context)return null;
  selectionFormatRange={target:context.target,range:context.range.cloneRange()};
  return {target:context.target,range:context.range.cloneRange()};
}

function restoreFormatSelection(saved){
  if(!saved?.target?.isConnected)return false;
  saved.target.focus();
  const selection=window.getSelection();selection.removeAllRanges();selection.addRange(saved.range);
  return true;
}

function selectionElement(saved){
  if(!saved?.range||!saved.target)return saved?.target;
  let node=saved.range.startContainer;
  if(node?.nodeType===Node.ELEMENT_NODE&&node.childNodes[saved.range.startOffset])node=node.childNodes[saved.range.startOffset];
  let element=node?.nodeType===Node.ELEMENT_NODE?node:node?.parentElement;
  while(element&&element!==saved.target){
    if(element.hasAttribute?.('style')||/^(B|STRONG|I|EM|U|S|STRIKE|DEL|FONT)$/.test(element.tagName))return element;
    element=element.parentElement;
  }
  return saved.target;
}

function setSelectedFontSize(target,range,size){
  const normalized=`${Math.max(10,Math.min(72,Number.parseInt(size,10)||14))}px`;
  target.querySelectorAll('font,span').forEach(node=>{
    try{
      if(range.intersectsNode(node)&&(/^(xxx-large|xx-large|x-large|large|medium|small|x-small|xx-small)$/i.test(node.style.fontSize)||node.tagName==='FONT')){
        node.style.fontSize=normalized;node.removeAttribute('size');
      }
    }catch(error){/* 节点在选区变化期间被移除时忽略 */}
  });
}

function applyInlineRangeStyles(saved,styles){
  if(!restoreFormatSelection(saved))return false;
  const selection=window.getSelection();const range=selection.getRangeAt(0);
  if(range.collapsed)return false;
  const wrapper=document.createElement('span');
  Object.entries(styles).forEach(([property,value])=>{if(value)wrapper.style[property]=value;});
  wrapper.appendChild(range.extractContents());range.insertNode(wrapper);
  const next=document.createRange();next.selectNodeContents(wrapper);selection.removeAllRanges();selection.addRange(next);
  return true;
}

function selectedCaseIds(){
  return Array.from($$('.case-select:checked')).map(box=>Number(box.value)).filter(Number.isInteger);
}

function updateDefaultFormatControls(){
  activateFormatScope();
  const color=$('#format-font-color');const size=$('#format-font-size');
  const defaults=state.defaultFormat;
  if(color)color.value=defaults.color;
  if(size)size.value=String(defaults.fontSize);
}

function setDefaultFormat(format,value=null){
  const defaults=activateFormatScope();
  if(format==='color')defaults.color=value||'#303133';
  else if(format==='fontSize')defaults.fontSize=Math.max(10,Math.min(72,Number.parseInt(value,10)||14));
  else if(format==='bold'||format==='italic'||format==='underline'||format==='strike')defaults[format]=!defaults[format];
  else if(['left','center','right'].includes(format))defaults.textAlign=format;
  updateDefaultFormatControls();
  showToast('已设置为下次输入的默认格式');
}

function formatWholeValue(value,format,formatValue=null){
  const box=document.createElement('div');
  box.innerHTML=isRichTextValue(value)?richTextHtml(value):escapeHtml(value??'').replace(/\r?\n/g,'<br>');
  if(['left','center','right'].includes(format)){
    box.style.textAlign=format;
    return box.innerHTML?`<div style="text-align:${format}">${box.innerHTML}</div>`:'';
  }
  const wrapper=document.createElement('span');
  if(format==='color')wrapper.style.color=formatValue||'#f56c6c';
  if(format==='fontSize')wrapper.style.fontSize=`${Math.max(10,Math.min(72,Number.parseInt(formatValue,10)||14))}px`;
  if(format==='bold')wrapper.style.fontWeight='bold';
  if(format==='italic')wrapper.style.fontStyle='italic';
  if(format==='underline')wrapper.style.textDecoration='underline';
  if(format==='strike')wrapper.style.textDecoration='line-through';
  while(box.firstChild)wrapper.appendChild(box.firstChild);
  box.appendChild(wrapper);
  return box.innerHTML;
}

async function applyFormatToSelectedRows(format,value=null,rowIds=[]){
  const selected=new Set(rowIds.map(Number));
  const columns=visibleColumns().filter(col=>col.key!=='case_no'&&col.key!=='status');
  const jobs=[];
  state.cases.filter(tc=>selected.has(Number(tc.id))).forEach(tc=>columns.forEach(col=>{
    const oldValue=getCaseColumnValue(tc,col);
    if(oldValue===null||oldValue===undefined||String(oldValue)==='')return;
    const nextValue=formatWholeValue(oldValue,format,value);
    const payload=col.is_system?{[col.key]:nextValue}:{custom_fields:{[col.key]:nextValue}};
    jobs.push(api(`/api/cases/${tc.id}`,{method:'PUT',body:JSON.stringify(payload)}));
  }));
  if(!jobs.length){showToast('选中行没有可格式化的文字','error');return;}
  try{await Promise.all(jobs);await loadCases();showToast(`已应用到 ${selected.size} 行`);}
  catch(err){showToast(err.message,'error');}
}

async function applyToolbarFormat(format,value=null){
  const saved=savedFormatSelection();
  const hasText=Boolean(saved&&!saved.range.collapsed&&saved.target.contains(saved.range.commonAncestorContainer));
  const rows=selectedCaseIds();
  if(!hasText){
    if(rows.length&&['color','fontSize','bold','italic','underline','strike','left','center','right'].includes(format)){
      await applyFormatToSelectedRows(format,value);
    }else if(format==='color'||format==='fontSize'||format==='bold'||format==='italic'||format==='underline'||format==='strike'||['left','center','right'].includes(format)){
      setDefaultFormat(format,value);
    }
    state.formatToolbarInteraction=false;
    return;
  }
  if(!restoreFormatSelection(saved)){state.formatToolbarInteraction=false;return;}
  const selection=window.getSelection();
  document.execCommand('styleWithCSS',false,true);
  const commands={bold:'bold',italic:'italic',underline:'underline',strike:'strikeThrough',left:'justifyLeft',center:'justifyCenter',right:'justifyRight'};
  if(format==='color')applyInlineRangeStyles(saved,{color:value||'#303133'});
  else if(format==='fontSize')applyInlineRangeStyles(saved,{fontSize:`${Math.max(10,Math.min(72,Number.parseInt(value,10)||14))}px`});
  else if(commands[format])document.execCommand(commands[format],false,null);
  if(format==='fontSize'){
    // 直接写入 px，避免浏览器把字号转换成 xxx-large 等不可逆的相对值。
  }
  saved.target.dispatchEvent(new Event('input',{bubbles:true}));
  state.formatToolbarInteraction=false;
}

function captureFormatPainter(){
  const saved=savedFormatSelection();
  if(!saved){showToast('请先选中一段已有格式的文字','error');return;}
  const element=selectionElement(saved);
  const style=getComputedStyle(element||saved.target);
  state.formatPainterStyle={
    color:style.color,fontSize:style.fontSize,fontWeight:style.fontWeight,
    fontStyle:style.fontStyle,textDecoration:style.textDecorationLine||style.textDecoration,
    textAlign:style.textAlign,
  };
  state.formatPainterSource={target:saved.target,range:saved.range.cloneRange()};
  $('#format-painter')?.classList.add('active');
  // 格式刷工作时隐藏选中文字快捷工具条，避免两个工具条同时抢占选区。
  hideSelectionFormatMenu();
  state.formatToolbarInteraction=false;
  showToast('格式已复制，请选中文字后点击格式刷');
}

function applyFormatPainter(){
  const style=state.formatPainterStyle;
  const saved=savedFormatSelection();
  if(!style||!saved||!restoreFormatSelection(saved)){showToast('请先复制格式并选中文字','error');return;}
  applyInlineRangeStyles(saved,{color:style.color,fontSize:style.fontSize,fontWeight:parseInt(style.fontWeight,10)>=600?'bold':'normal',fontStyle:style.fontStyle==='italic'?'italic':'normal',textDecoration:[/underline/.test(style.textDecoration||'')?'underline':'',/(line-through|strike)/.test(style.textDecoration||'')?'line-through':''].filter(Boolean).join(' ')||'none'});
  saved.target.dispatchEvent(new Event('input',{bubbles:true}));
  // 格式刷保持亮起，可连续应用；再次点击格式刷才取消。
  state.formatToolbarInteraction=false;
  showToast('格式已应用');
}

function rangesEqual(first,second){
  if(!first||!second)return false;
  return first.startContainer===second.startContainer
    &&first.startOffset===second.startOffset
    &&first.endContainer===second.endContainer
    &&first.endOffset===second.endOffset;
}

function cancelFormatPainter(){
  state.formatPainterStyle=null;state.formatPainterSource=null;
  state.formatToolbarInteraction=false;
  $('#format-painter')?.classList.remove('active');
  hideSelectionFormatMenu();
  showToast('格式刷已取消');
}

function resetDefaultFormat(){
  const key=formatScopeKey();
  const defaults={...INITIAL_FORMAT};
  if(key)state.defaultFormats[key]=defaults;
  state.defaultFormat=defaults;
  cancelFormatPainter();updateDefaultFormatControls();showToast('已恢复初始编辑格式');
}

async function applyRowHeight(){
  if(!state.editMode||!state.currentVersion)return;
  const input=$('#format-row-height');
  const height=Math.max(24,Math.min(360,parseInt(input?.value,10)||36));
  if(input)input.value=height;
  const ids=Array.from($$('.case-select:checked')).map(box=>Number(box.value)).filter(Number.isInteger);
  const targetIds=ids.length?ids:(state.formatRowCaseId?[Number(state.formatRowCaseId)]:[]);
  if(!targetIds.length){showToast('请先选中用例行或点击一行','error');return;}
  try{
    await Promise.all(targetIds.map(id=>api(`/api/cases/${id}`,{method:'PUT',body:JSON.stringify({row_height:height})})));
    state.cases.forEach(tc=>{if(targetIds.includes(Number(tc.id)))tc.row_height=height;});
    targetIds.forEach(id=>{const row=$(`#case-table tbody tr[data-case-id="${id}"]`);if(row)row.style.height=`${height}px`;});
    showToast(`已保存 ${targetIds.length} 行的行高`);
  }catch(err){showToast(err.message,'error');}
}

function bindFormatToolbar(){
  const toolbar=$('#editor-format-toolbar');
  if(!toolbar||toolbar.dataset.bound==='1')return;
  toolbar.dataset.bound='1';
  // 点击工具栏会让 contenteditable 失焦，先把选区存下来，避免格式命令
  // 因为浏览器的 selectionchange 事件变成“没有选区”。
  toolbar.addEventListener('mousedown',e=>{
    state.formatToolbarInteraction=true;
    const context=getSelectedEditorContext();
    if(context)selectionFormatRange={target:context.target,range:context.range.cloneRange()};
    if(e.target.closest('button'))e.preventDefault();
  });
  toolbar.querySelectorAll('button[data-format]').forEach(button=>button.addEventListener('click',()=>applyToolbarFormat(button.dataset.format)));
  $('#format-font-color')?.addEventListener('change',e=>applyToolbarFormat('color',e.target.value));
  $('#format-font-size')?.addEventListener('change',e=>applyToolbarFormat('fontSize',e.target.value));
  $('#format-painter')?.addEventListener('click',()=>state.formatPainterStyle?cancelFormatPainter():captureFormatPainter());
  $('#format-reset')?.addEventListener('click',resetDefaultFormat);
  $('#apply-row-height')?.addEventListener('click',applyRowHeight);
  updateDefaultFormatControls();
}

document.addEventListener('selectionchange',()=>{
  if(state.formatToolbarInteraction)return;
  if(state.formatPainterStyle){hideSelectionFormatMenu();return;}
  if(window.getSelection()?.isCollapsed)hideSelectionFormatMenu();
  else showSelectionFormatMenu();
});
document.addEventListener('mouseup',()=>setTimeout(()=>{
  const context=getSelectedEditorContext();
  if(state.formatPainterStyle&&context&&state.formatPainterSource&&!rangesEqual(context.range,state.formatPainterSource.range)){
    void applyFormatPainter();
    hideSelectionFormatMenu();
    return;
  }
  if(state.formatPainterStyle){hideSelectionFormatMenu();return;}
  showSelectionFormatMenu();
},0));
document.addEventListener('keyup',e=>{if(e.shiftKey||e.key==='ArrowLeft'||e.key==='ArrowRight')showSelectionFormatMenu();});
document.addEventListener('mousedown',e=>{
  const menu=$('#selection-format-menu');
  if(e.target.closest?.('#editor-format-toolbar'))return;
  if(menu&&!menu.contains(e.target)){
    const context=getSelectedEditorContext();
    if(!context)hideSelectionFormatMenu();
  }
});

async function loadCaseImages(caseId){
  const res=await api(`/api/cases/${caseId}/images`);state.caseImages=res.data||[];renderImageList();
}

function getImageSrc(img){
  if(img.previewUrl)return img.previewUrl;
  if(img.content_url)return img.content_url;
  return '';
}
function renderImageList(){
  renderImageListInto($('#image-list'),state.editingCase?.id);
  renderImageListInto($('#cell-image-list'),state.editingCell?.caseId);
}
function renderImageListInto(list,caseId){
  if(!list)return;
  list.innerHTML='';
  state.caseImages.forEach(img=>appendImagePreview(list,img,()=>deleteImage(img.id,caseId)));
  if(list.id!=='image-list')return;
  state.pendingImages.forEach((file,index)=>{
    const preview={previewUrl:URL.createObjectURL(file),filename:file.name};
    appendImagePreview(list,preview,()=>{state.pendingImages.splice(index,1);renderImageList();});
  });
}
function appendImagePreview(list,img,onDelete){
  const wrapper=document.createElement('div');wrapper.className='image-preview';
  const image=document.createElement('img');image.src=getImageSrc(img);image.className='image-thumb';image.title='点击或双击放大';image.addEventListener('click',()=>openLightbox(image.src));image.addEventListener('dblclick',()=>openLightbox(image.src));
  const button=document.createElement('button');button.className='danger image-delete';button.type='button';button.textContent='×';button.title='删除图片';button.addEventListener('click',onDelete);
  wrapper.append(image,button);list.appendChild(wrapper);
}
function addPendingImages(files){
  const accepted=files.filter(isImageFile);
  state.pendingImages.push(...accepted);renderImageList();
  return accepted;
}
function captureRichSelection(target){
  if(!target?.isContentEditable)return null;
  const selection=window.getSelection();
  if(!selection?.rangeCount)return null;
  const range=selection.getRangeAt(0);
  return target.contains(range.commonAncestorContainer)?range.cloneRange():null;
}
function insertImageAtCaret(target,src,imageId=null,pendingToken=null,selectionRange=null,imageAttribute='data-image-id'){
  if(!target?.isContentEditable)return false;
  target.focus();
  const selection=window.getSelection();selection.removeAllRanges();
  if(selectionRange&&target.contains(selectionRange.commonAncestorContainer))selection.addRange(selectionRange);
  else{const range=document.createRange();range.selectNodeContents(target);range.collapse(false);selection.addRange(range);}
  const range=selection.getRangeAt(0);const image=document.createElement('img');
  image.className='rich-content-image';image.src=src;image.alt='图片';
  if(imageId)image.setAttribute(imageAttribute,String(imageId));
  if(pendingToken)image.dataset.pendingImage=pendingToken;
  range.deleteContents();range.insertNode(image);range.setStartAfter(image);range.collapse(true);
  selection.removeAllRanges();selection.addRange(range);
  target.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}
async function pasteImageFromClipboard(){
  if(!navigator.clipboard?.read){showToast('当前浏览器不支持读取剪贴板，请直接按 Ctrl+V','error');return;}
  try{
    const files=[];
    for(const item of await navigator.clipboard.read()){
      for(const type of item.types.filter(type=>type.startsWith('image/'))){
        const blob=await item.getType(type);files.push(new File([blob],`pasted-${Date.now()}.${type.split('/')[1]||'png'}`,{type}));
      }
    }
    if(!files.length){showToast('剪贴板中没有图片','error');return;}
    const target=document.activeElement?.closest?.('[contenteditable="true"]')||document.activeElement;
    await handlePastedImages(files,target,captureRichSelection(target));
  }catch(err){showToast('无法读取剪贴板，请确认浏览器已允许剪贴板权限','error');}
}
async function uploadImageFiles(caseId,files){
  if(!files.length)return [];
  const form=new FormData();files.forEach(file=>form.append('images',file));
  const res=await fetch(`/api/cases/${caseId}/images`,{method:'POST',body:form});
  const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.message||'图片上传失败');
  return data.data||[];
}
async function handlePastedRequirementImages(files,target,selectionRange){
  const requirementId=state.editingRequirement?.id;
  const richTarget=target?.isContentEditable?target:target?.closest?.('[contenteditable="true"]');
  if(!requirementId||!richTarget)return;
  try{
    const uploaded=await uploadRequirementImages(requirementId,files);
    for(const image of uploaded){
      insertImageAtCaret(richTarget,image.content_url||`/api/requirement-images/${image.id}/content`,image.id,null,selectionRange,'data-requirement-image-id');
      selectionRange=captureRichSelection(richTarget);
      const images=state.editingRequirement.images||[];
      if(!images.some(item=>Number(item.id)===Number(image.id)))images.push(image);
      state.editingRequirement.images=images;
    }
    showToast('图片已粘贴到需求正文');
  }catch(err){showToast(err.message,'error');}
}
async function deleteImage(imageId,caseId){if(!confirm('确定删除该图片？'))return;try{await api(`/api/images/${imageId}`,{method:'DELETE'});await loadCaseImages(caseId);}catch(err){showToast(err.message,'error');}}
function addCase(){openCaseModal();}
function editCase(id){openCaseModal(state.cases.find(c=>c.id===id));}

async function saveCase(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  const payload={project_id:state.currentProject.id,version_id:state.currentVersion.id,custom_fields:{}};
  $$('.case-form-field').forEach(input=>{
    const col=state.columns.find(c=>c.key===input.dataset.key);if(!col)return;
    const value=getEditorValue(input);
    if(col.is_system)payload[col.key]=value;
    else payload.custom_fields[col.key]=value;
  });
  const oldRemark=state.editingCase?.remark||'';
  const pendingMarkup=payload.remark||'';
  const createPayload={...payload,remark:pendingMarkup.replace(/<img[^>]*data-pending-image="[^"]+"[^>]*>/gi,'')};
  try{
    let caseId;
    if(state.editingCase){
      const res=await api(`/api/cases/${state.editingCase.id}`,{method:'PUT',body:JSON.stringify(payload)});
      caseId=state.editingCase.id;
      // 更新本地缓存，确保列表立即回显
      const idx=state.cases.findIndex(c=>c.id===caseId);
      if(idx>=0&&res.data)state.cases[idx]=res.data;
    }else{
      const res=await api('/api/cases',{method:'POST',body:JSON.stringify(createPayload)});
      caseId=res.data.id;
    }
    const selectedFiles=Array.from($('#case-images')?.files||[]).concat(state.pendingImages);
    const uploaded=selectedFiles.length?await uploadImageFiles(caseId,selectedFiles):[];
    const uploadedByFile=new Map(selectedFiles.map((file,index)=>[file,uploaded[index]]));
    let finalRemark=pendingMarkup;
    for(const pending of state.pendingEmbeddedImages){
      const image=uploadedByFile.get(pending.file);if(!image)continue;
      const src=getImageSrc(image);
      const imageHtml=`<img class="rich-content-image" data-image-id="${image.id}" src="${escapeHtml(src)}" alt="图片">`;
      const marker=new RegExp(`<img\\b[^>]*data-pending-image=["']${pending.token}["'][^>]*>`, 'gi');
      finalRemark=finalRemark.replace(marker,imageHtml);
      if(!finalRemark.includes(`data-image-id="${image.id}"`))finalRemark+=imageHtml;
    }
    if(state.pendingEmbeddedImages.length&&finalRemark!==pendingMarkup){
      await api(`/api/cases/${caseId}`,{method:'PUT',body:JSON.stringify({remark:finalRemark})});
    }
    if(state.editingCase)await cleanupRemovedEmbeddedImages(caseId,oldRemark,finalRemark,state.caseModalUploadedImageIds);
    state.caseModalSaving=true;
    state.pendingImages=[];state.pendingEmbeddedImages=[];state.caseImages=[];state.caseModalUploadedImageIds=[];closeModal('#case-modal');state.caseModalSaving=false;state.pasteTarget=null;
    await loadColumns();
    await Promise.all([loadCases(),loadStats(),loadSummary()]);
    showToast('保存成功');
  }catch(err){showToast(err.message,'error');}
}

async function deleteCase(id){if(!confirm('确定删除该用例？'))return;try{await api(`/api/cases/${id}`,{method:'DELETE'});await Promise.all([loadCases(),loadStats()]);showToast('用例已删除');}catch(err){showToast(err.message,'error');}}

function addQuickRow(){
  if(!state.currentVersion){showToast('请先选择一个版本','error');return;}
  const count=prompt('要添加多少行？',1);
  if(count===null)return;
  state.actionsCollapsed=false;
  state.quickInsertCount=Math.max(1,Math.min(99,parseInt(count)||1));
  state.quickInsertTarget={type:'top'};
  state.quickAddRow=true;
  renderQuickAddRows();
}

function insertQuickRow(caseId,position,count=1,columnKey=''){
  if(!state.currentVersion)return;
  state.actionsCollapsed=false;
  state.quickInsertTarget=getSafeQuickInsertTarget(caseId,position,columnKey);
  state.quickInsertCount=Math.max(1,Math.min(99,count));
  state.quickAddRow=true;
  renderQuickAddRows();
}

function getSafeQuickInsertTarget(caseId,position,columnKey=''){
  if(!['above','below'].includes(position))return {type:position,caseId};
  // case_no 是每条真实用例独立的系统列。即使同一行的其他列被合并，
  // 从序号列插入也必须严格以当前真实行作为锚点。
  if(columnKey==='case_no')return {type:position,caseId,columnKey};
  const targetIndex=state.cases.findIndex(tc=>Number(tc.id)===Number(caseId));
  if(targetIndex<0)return {type:position,caseId};
  let boundaryIndex=targetIndex;
  (state.merges||[]).forEach(merge=>{
    const memberIndexes=(merge.case_ids||[])
      .map(id=>state.cases.findIndex(tc=>Number(tc.id)===Number(id)))
      .filter(index=>index>=0);
    if(memberIndexes.length<2||!memberIndexes.includes(targetIndex))return;
    boundaryIndex=position==='above'
      ?Math.min(boundaryIndex,...memberIndexes)
      :Math.max(boundaryIndex,...memberIndexes);
  });
  return {type:position,caseId:state.cases[boundaryIndex]?.id??caseId,columnKey};
}

function insertQuickRowPrompt(caseId,position,columnKey=''){
  const n=prompt('插入行数（1~99）：',1);
  if(n===null)return;
  insertQuickRow(caseId,position,parseInt(n)||1,columnKey);
}

function cancelQuickRow(){state.quickAddRow=false;state.quickInsertTarget=null;state.quickInsertCount=1;renderTable();}

function buildQuickInputRow(i,cols){
  return cols.map(c=>{
    if(c.key==='status')return `<td><select id="qa-status-${i}">${STATUS_LIST.map(s=>`<option value="${s}" ${s==='未执行'?'selected':''}>${s}</option>`).join('')}</select></td>`;
    const isLong=c.key==='steps'||c.key==='remark'||c.key==='precondition'||c.key==='expected_result'||!c.is_system;
    return `<td>${isLong?`<textarea id="qa-${c.key}-${i}"></textarea>`:`<input id="qa-${c.key}-${i}">`}</td>`;
  }).join('')+`<td class="actions-cell">${i===0?`<button onclick="saveQuickRows()">保存</button><button class="secondary" onclick="cancelQuickRow()">取消</button>`:'&nbsp;'}</td>`;
}

function renderQuickAddRows(){
  if(!state.currentVersion){
    state.quickAddRow=false;
    renderTable();
    return;
  }
  const cols=visibleColumns();
  const thead=$('#case-table thead');
  const tbody=$('#case-table tbody');
  const showSelection=state.editMode;
  const ths=cols.map(c=>`<th data-key="${escapeHtml(c.key)}" data-id="${c.id}" style="width:${c.width}px"><span class="col-title">${escapeHtml(c.name)}</span></th>`).join('');
  thead.innerHTML=`<tr>${showSelection?'<th class="select-header" style="width:44px"></th>':''}${ths}${renderActionsHeader()}</tr>`;
  bindColumnContextMenu();
  tbody.innerHTML='';
  const count=state.quickInsertCount||1;
  const target=state.quickInsertTarget||{type:'top'};
  const targetId=target.caseId;
  const pos=target.type;
  const pageIds=state.cases.map(tc=>tc.id);

  function appendInputRow(i){const tr=document.createElement('tr');tr.className='quick-add-row';tr.innerHTML=`${showSelection?'<td class="select-cell"></td>':''}${buildQuickInputRow(i,cols)}`;tbody.appendChild(tr);}
  function appendExistingRow(tc){
    const tr=document.createElement('tr');
    tr.dataset.caseId=tc.id;
    applyCaseRowHeightStyle(tr,Number(tc.row_height)||36);
    tr.addEventListener('mousedown',()=>{state.formatRowCaseId=tc.id;});
    tr.addEventListener('contextmenu',showRowContextMenu);
    const selection=showSelection?`<td class="select-cell"><input type="checkbox" class="case-select" value="${tc.id}" onchange="updateSelectedCaseCount()" onclick="event.stopPropagation()" title="选择用例"></td>`:'';
    // 新增输入行可能位于原合并区域内部。预览阶段禁止 rowspan 跨过输入行，
    // 否则浏览器会吞掉后续行对应的单元格，表现为数据向前一列错位。
    tr.innerHTML=`${selection}${cols.map(c=>renderCell(c,tc,pageIds,true)).join('')}${renderActionsCell(tc.id)}`;
    tbody.appendChild(tr);
  }

  if(pos==='top'){
    for(let i=0;i<count;i++)appendInputRow(i);
    state.cases.forEach(appendExistingRow);
  }else if(pos==='above'||pos==='below'){
    state.cases.forEach(tc=>{
      if(pos==='above'&&tc.id===targetId){for(let i=0;i<count;i++)appendInputRow(i);}
      appendExistingRow(tc);
      if(pos==='below'&&tc.id===targetId){for(let i=0;i<count;i++)appendInputRow(i);}
    });
  }else{
    for(let i=0;i<count;i++)appendInputRow(i);
  }
  bindRowHeightResize();
}

async function saveQuickRows(){
  if(!state.currentVersion)return;
  const cols=visibleColumns();
  const count=state.quickInsertCount||1;
  const target=state.quickInsertTarget||{};
  const payloads=[];
  for(let i=0;i<count;i++){
    const payload={project_id:state.currentProject.id,version_id:state.currentVersion.id,custom_fields:{}};
    cols.forEach(c=>{const el=document.getElementById(`qa-${c.key}-${i}`);if(!el)return;if(c.is_system)payload[c.key]=el.value;else payload.custom_fields[c.key]=el.value;});
    if(!STATUS_LIST.includes(payload.status))payload.status='未执行';
    payloads.push(payload);
  }
  try{
    await api('/api/cases/batch',{
      method:'POST',
      body:JSON.stringify({
        project_id:state.currentProject.id,
        version_id:state.currentVersion.id,
        cases:payloads,
        insert_target:target.caseId||null,
        insert_position:target.type==='top'?null:target.type,
        insert_column_key:target.columnKey||null
      })
    });
    state.quickAddRow=false;state.quickInsertTarget=null;state.quickInsertCount=1;
    await Promise.all([loadCases(),loadStats(),loadSummary()]);
    showToast('已添加');
  }catch(err){showToast(err.message,'error');}
}

let draggedColumnItem=null;

function openColumnModal(){
  const body=$('#column-form-body');
  const systemOptions=state.columns.filter(c=>c.is_system).map(c=>`<option value="${escapeHtml(c.key)}">转为“${escapeHtml(c.name)}”</option>`).join('');
  body.innerHTML=state.columns.map((c,idx)=>`
    <div class="column-setting-item" draggable="true" data-id="${c.id}" data-key="${escapeHtml(c.key)}" data-system="${c.is_system?'true':'false'}" data-idx="${idx}">
      <span class="drag-handle">⋮⋮</span>
      <label>
        <input type="checkbox" class="col-vis" data-id="${c.id}" ${c.is_visible?'checked':''}>
      </label>
      ${!c.is_system&&state.editMode
        ?`<input class="column-name-input" data-id="${c.id}" value="${escapeHtml(c.name)}" maxlength="100" aria-label="自定义列名称">`
        :`<span class="column-setting-name" title="${escapeHtml(c.name)}">${escapeHtml(c.name)}</span>`}
      ${c.is_system?'<span class="tag">系统列</span>':`<span class="tag custom-tag">${c.aggregate_type==='sum'?'数字求和列':'自定义列'}</span>`}
      ${c.is_system&&c.key==='case_no'?`<button class="secondary reset-column-number-btn" onclick="resetCaseNumbers()">重置编号</button>`:''}
      ${c.is_system&&c.key==='status'?`<button class="secondary reset-column-status-btn" onclick="resetCaseStatus()">重置测试结果</button>`:''}
      ${!c.is_system&&state.editMode?`<select class="convert-system-select" onchange="convertColumnToSystem(${c.id},this.value)"><option value="">转为系统列…</option>${systemOptions}</select>`:''}
      ${!c.is_system&&state.editMode?`<button class="danger" onclick="removeCustomColumn(${c.id})">删除</button>`:''}
    </div>`).join('');
  bindColumnDrag();
  openModal('#column-modal');
}

async function resetCaseStatus(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  if(!confirm('确定将当前版本全部用例的执行结果重置为“未执行”吗？'))return;
  try{
    const res=await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/reset-status`,{method:'POST'});
    await Promise.all([loadCases(),loadStats()]);
    showToast(`已重置 ${res.data?.reset||0} 条用例的测试结果`);
  }catch(err){showToast(err.message,'error');}
}

async function convertColumnToSystem(columnId,systemKey){
  if(!systemKey)return;
  const column=state.columns.find(c=>c.id===columnId);if(!column)return;
  if(!confirm(`确定将“${column.name}”转为系统列吗？该列数据会写入对应系统字段。`)){openColumnModal();return;}
  try{
    await api(`/api/columns/${columnId}`,{method:'PUT',body:JSON.stringify({convert_to_system:systemKey})});
    await loadColumns();await loadCases();openColumnModal();renderTable();showToast('列已转换为系统列');
  }catch(err){showToast(err.message,'error');openColumnModal();}
}

function bindColumnDrag(){
  const items=$$('.column-setting-item');
  items.forEach(item=>{
    item.addEventListener('dragstart',e=>{draggedColumnItem=item;item.classList.add('dragging');e.dataTransfer.effectAllowed='move';});
    item.addEventListener('dragend',()=>{if(draggedColumnItem)draggedColumnItem.classList.remove('dragging');draggedColumnItem=null;});
    item.addEventListener('dragover',e=>{
      e.preventDefault();
      if(!draggedColumnItem||draggedColumnItem===item)return;
      const rect=item.getBoundingClientRect();
      const mid=rect.top+rect.height/2;
      const parent=item.parentNode;
      if(e.clientY<mid)parent.insertBefore(draggedColumnItem,item);
      else parent.insertBefore(draggedColumnItem,item.nextSibling);
    });
  });
}

const DEFAULT_SYSTEM_COLUMN_ORDER=['case_no','module','title','precondition','steps','expected_result','priority','status','remark'];
function restoreDefaultColumnOrder(){
  const body=$('#column-form-body');
  const items=Array.from(body.querySelectorAll('.column-setting-item'));
  const participating=items.filter(item=>item.dataset.system==='true'&&item.querySelector('.col-vis')?.checked);
  if(participating.length<2){showToast('至少需要两个已勾选的系统列才能整理');return;}
  const order=new Map(DEFAULT_SYSTEM_COLUMN_ORDER.map((key,index)=>[key,index]));
  const sorted=participating.slice().sort((a,b)=>(order.get(a.dataset.key)??999)-(order.get(b.dataset.key)??999));
  const markers=participating.map(item=>{const marker=document.createComment('system-column-order');item.replaceWith(marker);return marker;});
  sorted.forEach((item,index)=>markers[index].replaceWith(item));
  showToast('已恢复系统列默认排序，请点击保存');
}

async function saveColumnSettings(){
  try{
    const items=$$('.column-setting-item');
    const orders={};
    items.forEach((item,idx)=>{orders[item.dataset.id]=idx;});
    const nameInputs=Array.from($$('.column-name-input'));
    if(nameInputs.some(input=>!input.value.trim())){showToast('自定义列名称不能为空','error');return;}
    await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/columns/order`,{method:'POST',body:JSON.stringify({orders})});
    for(const input of nameInputs){await api(`/api/columns/${input.dataset.id}`,{method:'PUT',body:JSON.stringify({name:input.value.trim()})});}
    for(const cb of $$('.col-vis')){
      await api(`/api/columns/${cb.dataset.id}`,{method:'PUT',body:JSON.stringify({is_visible:cb.checked})});
    }
    await loadColumns();
    renderTable();
    closeModal('#column-modal');
    showToast('列设置已保存');
  }catch(err){showToast(err.message,'error');}
}
function createCustomColumnKey(name){
  let normalized=(name??'').toString().replace(/[^0-9A-Za-z_]+/g,'_').replace(/^_+|_+$/g,'').toLowerCase();
  if(!normalized)normalized='column';
  if(/^\d/.test(normalized))normalized=`column_${normalized}`;
  const used=new Set((state.columns||[]).map(column=>column.key));
  const base=`c_${normalized}`;
  let key=base;let suffix=2;
  while(used.has(key)){key=`${base}_${suffix}`;suffix+=1;}
  return key;
}
async function addCustomColumn(){
  const name=prompt('请输入自定义列名称（例如：环境、设备型号）：');
  if(!name?.trim())return;
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  const key=createCustomColumnKey(name.trim());
  try{
    await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/columns`,{method:'POST',body:JSON.stringify({name:name.trim(),key})});
    await loadColumns();openColumnModal();renderTable();showToast('自定义列已添加');
  }catch(err){showToast(err.message,'error');}
}
async function addSumColumn(){
  const name=prompt('请输入数字求和列名称（例如：里程）：');
  if(!name?.trim())return;
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  const key=createCustomColumnKey(name.trim());
  try{
    await api(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/columns`,{method:'POST',body:JSON.stringify({name:name.trim(),key,aggregate_type:'sum'})});
    await loadColumns();await loadStats();openColumnModal();renderTable();showToast(`数字求和列“${name.trim()}”已添加`);
  }catch(err){showToast(err.message,'error');}
}
async function removeCustomColumn(id){if(!confirm('删除该列会清空所有用例中对应字段的数据，确定继续？'))return;try{await api(`/api/columns/${id}`,{method:'DELETE'});await loadColumns();openColumnModal();renderTable();showToast('列已删除');}catch(err){showToast(err.message,'error');}}

function openImportModal(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本，再导入 Excel','error');return;}
  openModal('#import-modal');$('#import-progress').style.width='0%';$('#import-progress').textContent='';$('#import-result').textContent='';
}
const dropzone=$('#import-dropzone');['dragenter','dragover'].forEach(ev=>{dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.add('dragover');});});['dragleave','drop'].forEach(ev=>{dropzone.addEventListener(ev,e=>{e.preventDefault();dropzone.classList.remove('dragover');});});
dropzone.addEventListener('drop',e=>{const files=e.dataTransfer.files;if(files.length)uploadExcel(files[0]);});
dropzone.addEventListener('click',()=>$('#import-file').click());
$('#import-file').addEventListener('change',e=>{if(e.target.files.length)uploadExcel(e.target.files[0]);});
async function uploadExcel(file){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本，再导入 Excel','error');return;}
  $('#import-progress').style.width='10%';$('#import-progress').textContent='解析中...';const form=new FormData();form.append('file',file);
  try{$('#import-progress').style.width='50%';const res=await fetch(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/import`,{method:'POST',body:form});const data=await res.json();if(data.success){$('#import-progress').style.width='100%';$('#import-progress').textContent='100%';$('#import-result').textContent=`导入成功：共导入 ${data.data.imported} 条用例`;await loadColumns();await Promise.all([loadCases(),loadStats()]);setTimeout(()=>closeModal('#import-modal'),1200);}else{throw new Error(data.message);}}catch(err){$('#import-progress').style.width='0%';$('#import-progress').textContent='';$('#import-result').textContent='导入失败：'+err.message;showToast(err.message,'error');}
}

async function backupDb(){
  const path=prompt('请输入备份保存目录（留空使用默认目录）：','');if(path===null)return;
  try{const body=path?JSON.stringify({backup_dir:path}):JSON.stringify({});const res=await api('/api/backup',{method:'POST',body:body});showToast(`备份已保存：${res.data.path}`);}catch(err){showToast(err.message,'error');}
}

async function exportCurrentVersionExcel(){
  if(!state.currentProject||!state.currentVersion){showToast('请先选择项目和版本','error');return;}
  const url=`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/export`;
  try{
    showToast('正在生成 Excel，请稍候');
    const res=await fetch(url);
    if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.message||`导出失败 ${res.status}`);}
    const blob=await res.blob();
    const objectUrl=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=objectUrl;link.download=`${state.currentProject.name}_${state.currentVersion.version_name}_用例.xlsx`;
    document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(objectUrl);
    showToast('Excel 下载成功');
  }catch(err){showToast(err.message,'error');}
}

async function downloadSummary(format){
  if(!state.currentProject||!state.currentVersion)return;
  const params=new URLSearchParams({
    format,
    field_key:state.summaryFieldKey||'remark',
    show_images:state.summaryShowImages?'1':'0',
  });
  try{
    showToast(`正在生成总结${format==='html'?' HTML':'图片'}，请稍候`);
    const res=await fetch(`/api/projects/${state.currentProject.id}/versions/${state.currentVersion.id}/summary/export?${params}`);
    if(!res.ok){const data=await res.json().catch(()=>({}));throw new Error(data.message||`导出失败 ${res.status}`);}
    const blob=await res.blob();
    const objectUrl=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=objectUrl;
    link.download=`${state.currentProject.name}_${state.currentVersion.version_name}_执行总结.${format}`;
    document.body.appendChild(link);link.click();link.remove();URL.revokeObjectURL(objectUrl);
    showToast('总结导出成功');
  }catch(err){showToast(err.message,'error');}
}

// 图片粘贴上传（弹窗内任意位置，包括备注框）
function isImageFile(file){return !!file&&(file.type?.startsWith('image/')||/\.(png|jpe?g|gif|bmp|webp)$/i.test(file.name||''));}
function getPastedImageFiles(event){
  const files=[];
  const clipboard=event.clipboardData;
  if(!clipboard)return files;
  Array.from(clipboard.files||[]).forEach(file=>{if(isImageFile(file))files.push(file);});
  Array.from(clipboard.items||[]).forEach(item=>{
    if(!item.type?.startsWith('image/'))return;
    const file=item.getAsFile?.();
    if(file)files.push(file);
  });
  return files;
}
function uniqueImageFiles(files){
  const seen=new Set();
  return files.filter(file=>{
    // 同一次剪贴板事件可能同时从 clipboard.files 和 clipboard.items
    // 取到同一张图片，但两份 File 的 lastModified/name 可能不同；
    // 使用内容特征去重，避免一张图被重复插入或上传。
    const key=[file.type||'',file.size||0,file.name||''].join('|');
    if(seen.has(key))return false;
    seen.add(key);return true;
  });
}

function isRepeatedImagePaste(target,files,html,plainText){
  const fileSignature=files.map(file=>[file.type||'',file.size||0,file.name||''].join(':')).sort().join(',');
  const signature=`${plainText||''}|${(html||'').slice(0,4000)}|${fileSignature}`;
  const now=Date.now();
  const previous=recentPasteByTarget.get(target);
  recentPasteByTarget.set(target,{signature,time:now});
  // 某些剪贴板驱动会在一次 Ctrl+V 中连续派发两个 paste 事件。
  // 第二个事件直接拦截，防止同一张图片被再次上传；正常再次粘贴间隔足够长时不受影响。
  return Boolean(previous&&previous.signature===signature&&now-previous.time<300);
}

// 粘贴外部网页、Excel 或聊天内容时，只保留用例需要的文字结构。
// 外部内容中的 style/class/字体标签不再进入数据库，避免出现一堆不可读的 HTML。
function normalizePastedText(value){
  return (value??'').toString()
    .replace(/\r\n?/g,'\n')
    .replace(/\u00a0/g,' ')
    .replace(/[ \t]+\n/g,'\n')
    .replace(/\n{3,}/g,'\n\n');
}

function normalizePastedHtml(html,plainText=''){
  const raw=(html??'').toString();
  if(!raw.trim()){
    return escapeHtml(normalizePastedText(plainText)).replace(/\n/g,'<br>');
  }
  const template=document.createElement('template');
  template.innerHTML=raw;
  const blocked=new Set(['SCRIPT','STYLE','META','LINK','TITLE','HEAD','IFRAME','OBJECT','EMBED','NOSCRIPT']);
  const blockTags=new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DIV','DL','DT','DD','FIELDSET','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TBODY','TD','TFOOT','TH','THEAD','TR','UL']);
  const output=[];
  const appendBreak=()=>{
    while(output.length&&output[output.length-1]==='<br>')output.pop();
    if(output.length)output.push('<br>');
  };
  const appendText=value=>{
    const text=normalizePastedText(value);
    // HTML 源码的缩进空白不是用户输入，块标签已经负责换行。
    if(!text||(!text.trim()&&text.includes('\n')))return;
    output.push(escapeHtml(text));
  };
  const walk=node=>{
    if(node.nodeType===Node.TEXT_NODE){appendText(node.nodeValue);return;}
    if(node.nodeType!==Node.ELEMENT_NODE)return;
    const tag=node.tagName;
    if(blocked.has(tag))return;
    const isBlock=blockTags.has(tag);
    if(isBlock)appendBreak();
    if(tag==='BR'){
      appendBreak();
    }else if(tag==='IMG'){
      const src=(node.getAttribute('src')||'').trim();
      // 只有数据库图片可以原样带入，外部图片交给图片粘贴上传流程。
      const id=Number(node.getAttribute('data-image-id'));
      if(src.startsWith('/api/images/')&&Number.isInteger(id)&&id>0){
        output.push(`<img class="rich-content-image" src="${escapeHtml(src)}" alt="图片" data-image-id="${id}">`);
      }
    }else if(tag==='S'||tag==='STRIKE'||tag==='DEL'){
      output.push('<s>');
      Array.from(node.childNodes).forEach(walk);
      output.push('</s>');
    }else{
      Array.from(node.childNodes).forEach(walk);
    }
    if(isBlock)appendBreak();
  };
  Array.from(template.content.childNodes).forEach(walk);
  while(output[0]==='<br>')output.shift();
  while(output[output.length-1]==='<br>')output.pop();
  const result=output.join('');
  // 某些程序只提供纯文本版本，HTML 版本却只有不可用的外部图片。
  if(!result.replace(/<br>|<s>|<\/s>/g,'').trim()){
    const text=normalizePastedText(plainText).replace(/^\s*\[图片\]\s*$/,'');
    return escapeHtml(text).replace(/\n/g,'<br>');
  }
  return result;
}

function insertPastedContentAtCaret(target,html,selectionRange=null){
  if(!target?.isContentEditable||!html)return false;
  target.focus();
  const selection=window.getSelection();selection.removeAllRanges();
  if(selectionRange&&target.contains(selectionRange.commonAncestorContainer))selection.addRange(selectionRange);
  else{
    const range=document.createRange();range.selectNodeContents(target);range.collapse(false);selection.addRange(range);
  }
  const range=selection.getRangeAt(0);
  const fragment=range.createContextualFragment(html);
  const last=fragment.lastChild;
  range.deleteContents();range.insertNode(fragment);
  const caret=document.createRange();
  if(last){caret.setStartAfter(last);caret.collapse(true);}else{caret.selectNodeContents(target);caret.collapse(false);}
  selection.removeAllRanges();selection.addRange(caret);
  target.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}

async function readClipboardHtmlImageFiles(html){
  if(!html)return [];
  const files=[];
  const matches=[...html.matchAll(/<img[^>]+src=["'](data:image\/[\w.+-]+;base64,[^"']+)["'][^>]*>/gi)];
  for(const match of matches){
    try{
      const blob=await fetch(match[1]).then(res=>res.blob());
      if(blob.type?.startsWith('image/')){
        files.push(new File([blob],`pasted-${Date.now()}-${files.length}.png`,{type:blob.type}));
      }
    }catch(err){}
  }
  return uniqueImageFiles(files);
}
async function readClipboardImageFiles(){
  if(!navigator.clipboard?.read)return [];
  const files=[];
  try{
    for(const item of await navigator.clipboard.read()){
      for(const type of item.types||[]){
        if(!type.startsWith('image/'))continue;
        const blob=await item.getType(type);
        files.push(new File([blob],`pasted-${Date.now()}.${type.split('/')[1]||'png'}`,{type}));
      }
    }
  }catch(err){return [];}
  return uniqueImageFiles(files);
}
async function handlePastedImages(files,target=null,selectionRange=null){
  files=uniqueImageFiles(files.filter(isImageFile));
  if(!files.length)return;
  const caseModalActive=$('#case-modal').classList.contains('active');
  const cellModalActive=$('#cell-editor-modal').classList.contains('active');
  const inlineEditingActive=target?.classList?.contains('inline-cell-editor');
  const caseId=caseModalActive?state.editingCase?.id:(cellModalActive?state.editingCell?.caseId:(inlineEditingActive?state.inlineEditing?.caseId:null));
  const richTarget=target?.isContentEditable?target:target?.closest?.('[contenteditable="true"]');
  if(!caseId){
    const accepted=addPendingImages(files);
    if(richTarget){
      for(const file of accepted){
        const token=`pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        state.pendingEmbeddedImages.push({file,token});
        insertImageAtCaret(richTarget,URL.createObjectURL(file),null,token,selectionRange);
        selectionRange=captureRichSelection(richTarget);
      }
    }
    showToast('图片已加入待保存列表');return;
  }
  try{
    const uploaded=await uploadImageFiles(caseId,files);
    for(const image of uploaded){
      const src=getImageSrc(image);
      if(richTarget)insertImageAtCaret(richTarget,src,image.id,null,selectionRange);
      if(state.editingCase?.id===caseId)state.caseModalUploadedImageIds.push(image.id);
      if(state.editingCell?.caseId===caseId)state.editingCell.uploadedImageIds.push(image.id);
      if(state.inlineEditing?.caseId===caseId)state.inlineEditing.uploadedImageIds.push(image.id);
      selectionRange=captureRichSelection(richTarget);
    }
    if(state.editingCase?.id===caseId||state.editingCell?.caseId===caseId)await loadCaseImages(caseId);
    showToast('图片粘贴成功');
  }catch(err){showToast(err.message,'error');}
}
function removeImagePlaceholder(target){
  if(!target)return;
  if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){
    const next=target.value.replace(/\s*\[图片\]\s*$/,'');
    if(next!==target.value){target.value=next;target.dispatchEvent(new Event('input',{bubbles:true}));}
    return;
  }
  if(target.isContentEditable){
    const nodes=[];const walker=document.createTreeWalker(target,NodeFilter.SHOW_TEXT);
    let node;while(node=walker.nextNode())nodes.push(node);
    let remaining='';
    for(let i=nodes.length-1;i>=0;i--){
      if(!remaining)remaining=nodes[i].textContent;
      else remaining=nodes[i].textContent+remaining;
    }
    if(!/^\s*\[图片\]\s*$/.test(remaining))return;
    const last=nodes[nodes.length-1];if(last)last.textContent=last.textContent.replace(/\s*\[图片\]\s*$/,'');
  }
}
function setupPasteHandler(){
  document.addEventListener('paste',async e=>{
    const modal=$('#case-modal');
    const cellModal=$('#cell-editor-modal');
    const requirementModal=$('#requirement-modal');
    const target=e.target?.closest?.('[contenteditable="true"]')||e.target;
    const inlineEditor=target?.classList?.contains('inline-cell-editor');
    const requirementEditor=target?.id==='requirement-content-editor';
    if(!modal.classList.contains('active')&&!cellModal.classList.contains('active')&&!requirementEditor&&!inlineEditor)return;
    // input/textarea 保持浏览器默认粘贴行为；这里只处理富文本编辑器。
    if(!target?.isContentEditable)return;
    let selectionRange=captureRichSelection(target);
    let files=uniqueImageFiles(getPastedImageFiles(e));
    const clipboardTypes=Array.from(e.clipboardData?.types||[]);
    const plainText=e.clipboardData?.getData('text/plain')||'';
    const html=e.clipboardData?.getData('text/html')||'';
    const imagePlaceholder=/^\s*\[图片\]\s*$/.test(plainText);
    const mayContainImage=files.length||imagePlaceholder||clipboardTypes.includes('Files')||clipboardTypes.some(type=>type.startsWith('image/'));
    if(mayContainImage&&isRepeatedImagePaste(target,files,html,plainText)){
      e.preventDefault();
      return;
    }
    const normalizedHtml=normalizePastedHtml(html,plainText);
    // 即使剪贴板里同时带了图片，也先插入清理后的文字，避免原来“整段文字消失”。
    // [图片] 是系统占位文本，不把它写进用例内容。
    const hasUsableText=normalizedHtml.replace(/<br>|<s>|<\/s>/g,'').trim()!==''
      &&!(/^(?:\s*<br>\s*)*\[图片\](?:\s*<br>\s*)*$/i.test(normalizedHtml));
    if(!mayContainImage&&!hasUsableText)return;
    e.preventDefault();
    if(hasUsableText){
      insertPastedContentAtCaret(target,normalizedHtml,selectionRange);
      selectionRange=captureRichSelection(target);
    }
    if(!mayContainImage)return;
    if(!files.length)files=await readClipboardImageFiles();
    if(!files.length)files=await readClipboardHtmlImageFiles(html);
    removeImagePlaceholder(target);
    if(requirementEditor){
      await handlePastedRequirementImages(files,target,selectionRange);
    }else{
      await handlePastedImages(files,target,selectionRange);
    }
  },true);
}
setupPasteHandler();
document.addEventListener('keydown',e=>{
  if(!e.ctrlKey||!e.shiftKey||e.key.toLowerCase()!=='x')return;
  const target=e.target?.closest?.('[contenteditable="true"]');
  if(!target)return;
  e.preventDefault();
  toggleStrike();
});
document.addEventListener('click',e=>{
  const image=e.target?.closest?.('.rich-content-image');
  if(!image)return;
  e.preventDefault();e.stopPropagation();openLightbox(image.currentSrc||image.src);
},true);

function bindColumnResize(){
  $$('.resize-handle').forEach(handle=>{
    handle.onmousedown=e=>{
      e.preventDefault();e.stopPropagation();
      const th=handle.closest('th');
      const key=th.dataset.key;
      const startX=e.clientX;
      const startW=th.offsetWidth;
      function onMove(ev){
        const w=Math.max(60,startW+ev.clientX-startX);
        th.style.width=w+'px';
      }
      function onUp(){
        document.removeEventListener('mousemove',onMove);
        document.removeEventListener('mouseup',onUp);
        const col=state.columns.find(c=>c.key===key);
        if(col){
          col.width=Math.max(60,th.offsetWidth);
          api(`/api/columns/${col.id}`,{method:'PUT',body:JSON.stringify({width:col.width})}).catch(()=>{});
        }
      }
      document.addEventListener('mousemove',onMove);
      document.addEventListener('mouseup',onUp);
    };
  });
}

// 事件绑定
$('#btn-add-project').onclick=createProject;
$('#btn-add-case').onclick=addCase;
$('#btn-import').onclick=openImportModal;
$('#btn-columns').onclick=openColumnModal;
$('#btn-export-excel').onclick=exportCurrentVersionExcel;
$('#btn-backup').onclick=backupDb;
$('#btn-search').onclick=()=>{state.keyword=$('#search-input').value;state.page=1;loadCases();};
$('#search-input').addEventListener('keydown',e=>{if(e.key==='Enter')$('#btn-search').click();});
$('#status-filter-trigger').onclick=toggleStatusFilter;
$$('input[name="status-filter-option"]').forEach(input=>input.addEventListener('change',onStatusFilterChange));
document.addEventListener('click',e=>{if(!e.target.closest('#status-filter'))$('#status-filter')?.classList.remove('open');});
updateStatusFilterUI();
$('#save-case-btn').onclick=saveCase;
$('#save-column-btn').onclick=saveColumnSettings;
$('#add-custom-column-btn').onclick=addCustomColumn;
$('#add-sum-column-btn').onclick=addSumColumn;
$('#restore-default-columns-btn').onclick=restoreDefaultColumnOrder;
$('#edit-mode-toggle').addEventListener('change',async e=>{
  // 切换开关会触发当前编辑器失焦。如果先重绘表格，编辑器节点会被移除，
  // 删除内容等最后一次修改就无法提交；先完成当前单元格保存，再切换界面。
  clearPendingCellClick();
  if(state.inlineEditing)await commitInlineCellEdit(state.inlineEditing);
  state.editMode=e.target.checked;
  if(state.editMode)state.actionsCollapsed=true;
  renderProjects();renderTable();renderPagination();
});
$('#btn-toggle-sidebar').onclick=()=>{state.sidebarCollapsed=!state.sidebarCollapsed;$('#sidebar').classList.toggle('collapsed',state.sidebarCollapsed);};
$('#btn-add-version').onclick=createVersion;
$('#btn-refresh-cases').onclick=refreshCurrentVersionCases;
$('#btn-requirements').onclick=()=>openRequirementModal();
$('#btn-quick-add').onclick=addQuickRow;
$('#btn-summary').onclick=openSummaryModal;
$('#btn-merge-cells').onclick=()=>toggleMergeMode('merge');
$('#btn-unmerge-cells').onclick=()=>toggleMergeMode('unmerge');
$('#btn-batch-delete').onclick=deleteSelectedCases;
$('#save-requirement-btn').onclick=saveRequirement;
function updateEditModeUI(){
  const button=$('#btn-batch-delete');
  if(button)button.style.display=state.editMode?'inline-flex':'none';
  const formatToolbar=$('#editor-format-toolbar');
  if(formatToolbar){
    const visible=state.editMode&&Boolean(state.currentVersion);
    formatToolbar.classList.toggle('visible',visible);
    formatToolbar.querySelectorAll('button,input,select').forEach(control=>{control.disabled=!visible;});
  }
}
updateEditModeUI();
$('#cell-editor-input').addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeCellEditor();}
  if(e.key==='Enter'&&e.ctrlKey){e.preventDefault();saveCellEditor();}
});
$$('.modal-overlay').forEach(m=>{m.addEventListener('click',e=>{if(e.target===m)m.classList.remove('active');});});
