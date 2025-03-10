import * as path from "path";
import {
  commands,
  Disposable,
  Event,
  EventEmitter,
  TreeDataProvider,
  TreeItem,
  TreeItemCollapsibleState,
  window
} from "vscode";
import { ISvnLogEntry, ISvnLogEntryPath } from "../common/types";
import { dispose } from "../util";
import {
  getCommitIcon,
  getCommitLabel,
  getCommitToolTip,
  getIconObject,
  ILogTreeItem,
  LogTreeItemKind,
  transform,
  getCommitDescription,
  SvnPath,
  getActionIcon
} from "./common";

export class RevisionViewerProvider
  implements TreeDataProvider<ILogTreeItem>, Disposable {
  private _onDidChangeTreeData: EventEmitter<
    ILogTreeItem | undefined
  > = new EventEmitter<ILogTreeItem | undefined>();
  public readonly onDidChangeTreeData: Event<ILogTreeItem | undefined> = this
    ._onDidChangeTreeData.event;
  private readonly logCache: Map<string, Map<string, ISvnLogEntry>> = new Map();
  private _dispose: Disposable[] = [];

  constructor() {
    this._dispose.push(
      window.registerTreeDataProvider("revisionviewer", this),
      commands.registerCommand(
        "svn.revisionviewer.addrevision",
        this.addRevision,
        this
      ),
      commands.registerCommand(
        "svn.revisionviewer.remove",
        this.removeCmd,
        this
      ),
      commands.registerCommand(
        "svn.revisionviewer.removeall",
        this.removeAllCmd,
        this
      )
    );
  }

  public dispose() {
    dispose(this._dispose);
  }

  public async addRevision(element: ILogTreeItem) {
    const svnTarget = element.parent!.data as SvnPath;
    const repoPath = svnTarget.toString();
    const logEntry = element.data as ISvnLogEntry;

    // Prevent duplicate revisions from being added
    if (this.logCache.has(repoPath)) {
      const cache = this.logCache.get(repoPath)!;
      if (!cache.has(logEntry.revision)) cache.set(logEntry.revision, logEntry);
    } else {
      const cache: Map<string, ISvnLogEntry> = new Map();
      cache.set(logEntry.revision, logEntry);
      this.logCache.set(repoPath, cache);
    }

    this._onDidChangeTreeData.fire();
  }

  public removeCmd(element: ILogTreeItem) {
    if (element.kind == LogTreeItemKind.Repo) {
      const repoPath = (element.data as SvnPath).toString();
      this.logCache.delete(repoPath);
    } else if (element.kind == LogTreeItemKind.Commit) {
      const revision = (element.data as ISvnLogEntry).revision;
      const repoPath = (element.parent?.data as SvnPath).toString();
      if (this.logCache.has(repoPath)) {
        const entries = this.logCache.get(repoPath)!;
        entries.delete(revision);

        // Was this the last revision from this repo?
        if (!entries.size) {
          this.logCache.delete(repoPath);
        }
      }
    }

    this._onDidChangeTreeData.fire();
  }

  public removeAllCmd() {
    this.logCache.clear();
    this._onDidChangeTreeData.fire();
  }

  public async getTreeItem(element: ILogTreeItem): Promise<TreeItem> {
    let ti: TreeItem;
    if (element.kind === LogTreeItemKind.Repo) {
      const svnTarget = element.data as SvnPath;
      ti = new TreeItem(
        svnTarget.toString(),
        TreeItemCollapsibleState.Expanded
      );
      ti.contextValue = "repo";
      ti.iconPath = getIconObject("icon-repo");
    } else if (element.kind === LogTreeItemKind.Commit) {
      const commit = element.data as ISvnLogEntry;
      ti = new TreeItem(
        getCommitLabel(commit),
        TreeItemCollapsibleState.Collapsed
      );
      ti.description = getCommitDescription(commit);
      ti.tooltip = getCommitToolTip(commit);
      ti.iconPath = getCommitIcon(commit.author);
      ti.contextValue = "commit";
    } else if (element.kind === LogTreeItemKind.CommitDetail) {
      // TODO optional tree-view instead of flat
      const pathElem = element.data as ISvnLogEntryPath;
      const basename = path.basename(pathElem._);
      ti = new TreeItem(basename, TreeItemCollapsibleState.None);
      ti.description = path.dirname(pathElem._);
      ti.iconPath = getActionIcon(pathElem.action);
      ti.contextValue = "diffable";
      ti.command = {
        command: "svn.repolog.openDiff",
        title: "Open diff",
        arguments: [element]
      };
    } else if (element.kind === LogTreeItemKind.TItem) {
      ti = element.data as TreeItem;
    } else {
      throw new Error("Unknown tree elem");
    }

    return ti;
  }

  public async getChildren(
    element: ILogTreeItem | undefined
  ): Promise<ILogTreeItem[]> {
    if (element === undefined) {
      return transform(
        [...this.logCache.keys()].map((path: string) => new SvnPath(path)),
        LogTreeItemKind.Repo
      );
    } else if (element.kind === LogTreeItemKind.Repo) {
      const repo = element.data as SvnPath;
      const repoPath = repo.toString();

      if (this.logCache.has(repoPath)) {
        const logentries = Array.from(
          this.logCache.get(repoPath)!.entries()
        ).map(([_, entry]) => entry);

        return transform(logentries, LogTreeItemKind.Commit, element);
      }
    } else if (element.kind === LogTreeItemKind.Commit) {
      const commit = element.data as ISvnLogEntry;
      return transform(commit.paths, LogTreeItemKind.CommitDetail, element);
    }
    return [];
  }
}
