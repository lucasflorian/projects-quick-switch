const vscode = require('vscode');
const projects = require('./projects');
const picker = require('./picker');

const t = vscode.l10n.t;

/** @type {vscode.StatusBarItem} */
let statusItem;

function currentName() {
	const uri = projects.currentUri();
	if (!uri) return vscode.workspace.name ?? t('No Project');
	const key = projects.keyOf(uri);
	return projects.getPinned().find((p) => projects.keyOf(p.uri) === key)?.name ?? projects.defaultName(uri);
}

function updateStatusBar() {
	if (!vscode.workspace.getConfiguration('projectSwitcher').get('showInStatusBar', true)) {
		statusItem.hide();
		return;
	}
	statusItem.text = `$(projects-quick-switch-logo) ${currentName()}`;
	statusItem.show();
}

async function addFolder() {
	const uris = await vscode.window.showOpenDialog({
		canSelectFolders: true,
		canSelectFiles: false,
		canSelectMany: true,
		openLabel: t('Add to Favorites'),
	});
	if (!uris) return;
	let added = 0;
	for (const uri of uris) if (await projects.pin(uri)) added++;
	vscode.window.showInformationMessage(added > 1 ? t('{0} projects added to favorites.', added) : added ? t('Added to favorites.') : t('Already in favorites.'));
}

async function pinCurrent() {
	const uri = projects.currentUri();
	if (!uri) {
		vscode.window.showWarningMessage(t('No project is open in this window.'));
		return;
	}
	const name = await vscode.window.showInputBox({ prompt: t('Favorite name'), value: currentName() });
	if (!name) return;
	await projects.unpin(uri);
	await projects.pin(uri, name.trim());
	updateStatusBar();
}

async function importProjectManager(context) {
	const added = await projects.importProjectManager(context);
	if (added === undefined) vscode.window.showWarningMessage(t('No Project Manager projects file found.'));
	else vscode.window.showInformationMessage(t('{0} project(s) imported from Project Manager.', added));
}

async function rescan() {
	await projects.rescan();
	const count = projects.getScanned().length;
	vscode.window.showInformationMessage(t('{0} project(s) found in the configured folders.', count));
}

function activate(context) {
	projects.init(context);

	statusItem = vscode.window.createStatusBarItem('projectSwitcher.current', vscode.StatusBarAlignment.Left, 100000);
	statusItem.name = t('Current Project');
	statusItem.tooltip = t('Switch Project');
	statusItem.command = 'projectSwitcher.open';
	updateStatusBar();

	context.subscriptions.push(
		statusItem,
		vscode.commands.registerCommand('projectSwitcher.open', () => picker.show()),
		vscode.commands.registerCommand('projectSwitcher.addFolder', addFolder),
		vscode.commands.registerCommand('projectSwitcher.pinCurrent', pinCurrent),
		vscode.commands.registerCommand('projectSwitcher.importProjectManager', () => importProjectManager(context)),
		vscode.commands.registerCommand('projectSwitcher.rescan', rescan),
		vscode.commands.registerCommand('projectSwitcher.configureShortcut', () =>
			vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'projectSwitcher.open'),
		),
		vscode.workspace.onDidChangeWorkspaceFolders(updateStatusBar),
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('projectSwitcher.showInStatusBar')) updateStatusBar();
			if (e.affectsConfiguration('projectSwitcher.scanFolders') || e.affectsConfiguration('projectSwitcher.scanDepth') || e.affectsConfiguration('projectSwitcher.scanMarkers')) projects.rescan();
		}),
	);

	projects.importProjectManagerOnce(context).then(updateStatusBar);
	projects.rescan();
}

function deactivate() {}

module.exports = { activate, deactivate };
