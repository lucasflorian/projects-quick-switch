const vscode = require('vscode');
const path = require('path');
const projects = require('./projects');

const SETTINGS_QUERY = '@ext:florian-lucas.projects-quick-switch';
const t = vscode.l10n.t;

/** Last list built in this window, shown instantly the next time the picker opens. */
let cache;

function config() {
	return vscode.workspace.getConfiguration('projectSwitcher');
}

async function collect() {
	const recents = await projects.getRecents();
	const pinned = projects.getPinned();
	const pinnedNames = new Map(pinned.map((p) => [projects.keyOf(p.uri), p.name]));
	const current = projects.currentUri();
	const seen = new Set(current ? [projects.keyOf(current)] : []);
	const list = [];
	const add = (uri, name, recent) => {
		const key = projects.keyOf(uri);
		if (seen.has(key)) return;
		seen.add(key);
		list.push({ uri, key, name: pinnedNames.get(key) ?? name, recent, pinned: pinnedNames.has(key) });
	};
	recents.forEach((r) => add(r.uri, r.name, true));
	pinned.forEach((p) => add(p.uri, p.name, false));
	projects.getScanned().forEach((uri) => add(uri, projects.defaultName(uri), false));
	return list;
}

function signature(list) {
	return list ? list.map((p) => `${p.key}|${p.name}|${p.recent}|${p.pinned}`).join('\n') : '';
}

function parentOf(uri) {
	if (uri.scheme === 'file') return projects.tildify(path.dirname(uri.fsPath));
	return `${uri.authority} ${path.posix.dirname(uri.path)}`.trim();
}

function toItem(project, display, newWindow) {
	const item = {
		label: project.name,
		iconPath: new vscode.ThemeIcon(project.pinned ? 'star-full' : projects.isWorkspaceFile(project.uri) ? 'files' : 'folder'),
		project,
		buttons: [
			newWindow
				? { iconPath: new vscode.ThemeIcon('window'), tooltip: t('Open in Current Window'), action: 'alternate' }
				: { iconPath: new vscode.ThemeIcon('empty-window'), tooltip: t('Open in New Window'), action: 'alternate' },
			project.pinned
				? { iconPath: new vscode.ThemeIcon('star-full'), tooltip: t('Remove from Favorites'), action: 'unpin' }
				: { iconPath: new vscode.ThemeIcon('star-empty'), tooltip: t('Add to Favorites'), action: 'pin' },
		],
	};
	if (project.uri.scheme === 'file') {
		item.buttons.push({ iconPath: new vscode.ThemeIcon('folder-opened'), tooltip: process.platform === 'darwin' ? t('Reveal in Finder') : t('Reveal in File Explorer'), action: 'reveal' });
	}
	if (project.recent) {
		item.buttons.push({ iconPath: new vscode.ThemeIcon('close'), tooltip: t('Remove from Recent'), action: 'forget' });
	}
	const parent = parentOf(project.uri);
	if (display === 'parentPath') item.description = parent;
	else if (display === 'parentPathBelow') item.detail = parent;
	else if (display === 'parentName') item.description = path.basename(parent);
	else if (display === 'parentNameBelow') item.detail = path.basename(parent);
	return item;
}

/** Other projects are only listed while searching, unless projectSwitcher.showOtherProjects is on. */
function buildItems(list, searching) {
	const display = config().get('pathDisplay', 'parentPath');
	const newWindow = config().get('openInNewWindow', true);
	const limit = config().get('recentLimit', 10);
	const byName = (a, b) => a.name.localeCompare(b.name, vscode.env.language, { sensitivity: 'base' });
	const recents = list.filter((p) => p.recent).slice(0, limit);
	const shown = new Set(recents);
	const pinned = list.filter((p) => !shown.has(p) && p.pinned).sort(byName);
	const showOthers = searching || config().get('showOtherProjects', false);
	const others = showOthers ? list.filter((p) => !shown.has(p) && !p.pinned).sort(byName) : [];
	const items = [];
	const section = (label, group) => {
		if (!group.length) return;
		items.push({ label, kind: vscode.QuickPickItemKind.Separator });
		group.forEach((p) => items.push(toItem(p, display, newWindow)));
	};
	section(t('Recent'), recents);
	section(t('Favorites'), pinned);
	section(t('Other Projects'), others);
	return items;
}

async function openProject(uri, newWindow) {
	const empty = !vscode.workspace.workspaceFolders?.length && !vscode.workspace.workspaceFile;
	const reuse = empty && config().get('reuseEmptyWindow', true);
	await vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: newWindow && !reuse });
}

async function show() {
	const qp = vscode.window.createQuickPick();
	qp.title = t('Projects');
	qp.placeholder = t('Search projects');
	qp.matchOnDescription = true;
	qp.matchOnDetail = true;
	qp.keepScrollPosition = true;
	qp.buttons = [
		{ iconPath: new vscode.ThemeIcon('add'), tooltip: t('Add a Folder to Favorites…'), action: 'add' },
		{ iconPath: new vscode.ThemeIcon('refresh'), tooltip: t('Search Projects in Folders'), action: 'rescan' },
		{ iconPath: new vscode.ThemeIcon('keyboard'), tooltip: t('Change Keyboard Shortcut'), action: 'shortcut' },
		{ iconPath: new vscode.ThemeIcon('settings-gear'), tooltip: t('Settings'), action: 'settings' },
	];

	let hidden = false;
	let searching = false;
	const render = (list, keepActive = true) => {
		if (hidden) return;
		const activeKey = keepActive && qp.activeItems[0]?.project?.key;
		qp.items = buildItems(list, searching);
		const active = activeKey && qp.items.find((i) => i.project?.key === activeKey);
		if (active) qp.activeItems = [active];
	};
	const refresh = async () => {
		const list = await collect();
		if (signature(list) === signature(cache)) return;
		cache = list;
		render(list);
	};

	qp.onDidChangeValue((value) => {
		if (!value === !searching || !cache) return;
		searching = !!value;
		render(cache, false);
	});

	qp.onDidAccept(() => {
		const project = qp.selectedItems[0]?.project;
		qp.hide();
		if (project) openProject(project.uri, config().get('openInNewWindow', true));
	});

	qp.onDidTriggerItemButton(async ({ item, button }) => {
		const { uri } = item.project;
		switch (button.action) {
			case 'alternate':
				qp.hide();
				await openProject(uri, !config().get('openInNewWindow', true));
				return;
			case 'pin':
				await projects.pin(uri, item.project.name);
				break;
			case 'unpin':
				await projects.unpin(uri);
				break;
			case 'reveal':
				await vscode.commands.executeCommand('revealFileInOS', uri);
				return;
			case 'forget':
				await vscode.commands.executeCommand('vscode.removeFromRecentlyOpened', uri);
				break;
		}
		await refresh();
	});

	qp.onDidTriggerButton(async (button) => {
		switch (button.action) {
			case 'add':
				qp.hide();
				await vscode.commands.executeCommand('projectSwitcher.addFolder');
				return;
			case 'rescan':
				qp.busy = true;
				await projects.rescan();
				await refresh();
				qp.busy = false;
				return;
			case 'shortcut':
				qp.hide();
				await vscode.commands.executeCommand('projectSwitcher.configureShortcut');
				return;
			case 'settings':
				qp.hide();
				await vscode.commands.executeCommand('workbench.action.openSettings', SETTINGS_QUERY);
		}
	});

	qp.onDidHide(() => {
		hidden = true;
		qp.dispose();
	});

	if (cache) render(cache);
	qp.busy = true;
	qp.show();
	await refresh();
	if (await projects.rescan()) await refresh();
	if (!hidden) qp.busy = false;
}

module.exports = { show };
