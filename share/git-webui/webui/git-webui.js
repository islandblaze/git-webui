"use strict"

var webui = webui || {};

webui.git = function(cmd, callback) {
    $.post("git", cmd, function(data, status, xhr) {
        if (xhr.status == 200) {
            if (callback) {
                callback(data);
            }
        } else {
            console.log(status + " " + data);
        }
    }, "text")
    .fail(function(xhr, status, error) {
        console.log(status + " "  + error);
    });
};

webui.splitLines = function(data) {
    return data.split("\n").filter(function(s) { return s.length > 0; })
}

/*
 * == SideBar =================================================================
 */
webui.SideBar = function(parent, rootElement) {

    this.mainUi = parent;
    var sideBar = this;

    var workspace = $("<h1>Workspace</h1>")[0];
    rootElement.appendChild(workspace);
    $(workspace).click(function (event) {
        sideBar.select(workspace);
        sideBar.mainUi.workspaceView.update();
    });

    webui.git("branch", function(data) {
        var branches = webui.splitLines(data);
        rootElement.appendChild($("<h1>Branches</h1>")[0]);
        var ul = $("<ul>").appendTo(rootElement)[0];
        branches.forEach(function (branch) {
            var name = branch.substr(2);
            var li = $("<li>" + name + "</li>").appendTo(ul)[0];
            li.name = name;
            $(li).click(function (event) { sideBar.select(li); });
            if (branch.substr(0, 1) == "*") {
                $(li).addClass("branch-current")
                window.setTimeout(function() { sideBar.select(li); }, 0);
            }
        });
    });

    webui.git("tag", function(data) {
        var tags = webui.splitLines(data);
        if (tags.length > 0) {
            rootElement.appendChild($("<h1>Tags</h1>")[0]);
            var ul = $("<ul>").appendTo(rootElement)[0];
            rootElement.appendChild(ul);
            tags.forEach(function (tag) {
                var li = $("<li>" + tag + "</li>").appendTo(ul)[0];
                li.name = tag;
                $(li).click(function (event) { sideBar.select(li); });
            });
        }
    });

    this.select = function(node) {
        var selected = $(".selected", rootElement);
        if (selected.length > 0) {
            selected = selected[0];
        } else {
            selected = undefined;
        }
        if (selected != node) {
            if (selected != undefined) {
                $(selected).toggleClass("selected");
            }
            $(node).toggleClass("selected");
            if (node.tagName == "LI") {
                // TODO: find a better way to distinguish history viewer and working copy nodes
                this.mainUi.historyView.update(node.name);
            }
        }
    };
};

/*
 * == LogView =================================================================
 */
webui.LogView = function(parent, rootElement) {

    var logView = this;
    this.historyView = parent;
    var currentSelection = null;

    this.update = function(ref) {
        $(rootElement).empty();
        webui.git("log --pretty=raw --decorate " + ref, function(data) {
            var start = 0;
            while (true) {
                var end = data.indexOf("\ncommit ", start);
                if (end != -1) {
                    var len = end - start;
                } else {
                    var len = undefined;
                }
                var entry = new Entry(data.substr(start, len));
                rootElement.appendChild(entry.createView());
                if (!currentSelection) {
                    entry.select();
                }
                if (len == undefined) {
                    break;
                }
                start = end + 1;
            }
        });
    };

    function Person(data) {
        var nameEnd = data.indexOf("<");
        this.name = data.substr(0, nameEnd - 1);
        var emailEnd = data.indexOf(">", nameEnd);
        this.email = data.substr(nameEnd + 1, emailEnd - nameEnd - 1);
        var dateEnd = data.indexOf(" ", emailEnd + 2);
        var secs = data.substr(emailEnd + 2, dateEnd - emailEnd - 2);
        this.date = new Date(0);
        this.date.setUTCSeconds(parseInt(secs));
    };

    function Entry(data) {
        this.parents = [];
        this.message = ""
        var entry = this;

        data.split("\n").forEach(function(line) {
            if (line.indexOf("commit ") == 0) {
                entry.commit = line.substr(7, 40);
                if (line.length > 47) {
                    entry.refs = []
                    var s = line.lastIndexOf("(") + 1;
                    var e = line.lastIndexOf(")");
                    line.substr(s, e - s).split(", ").forEach(function(ref) {
                        entry.refs.push(ref);
                    });
                }
            } else if (line.indexOf("parent ") == 0) {
                entry.parents.push(line.substr(7));
            } else if (line.indexOf("tree ") == 0) {
                entry.tree = line.substr(5);
            } else if (line.indexOf("author ") == 0) {
                entry.author = new Person(line.substr(7));
            } else if (line.indexOf("committer ") == 0) {
                entry.committer = new Person(line.substr(10));
            } else if (line.indexOf("    ") == 0) {
                entry.message += line.substr(4) + "\n";
            }
        });

        this.message = this.message.trimRight();

        this.abbrevCommitHash = function() {
            return this.commit.substr(0, 7);
        };

        this.abbrevMessage = function() {
            var end = this.message.indexOf("\n");
            if (end == -1) {
                return this.message
            } else {
                return this.message.substr(0, end);
            }
        };

        this.createView = function() {
            this.view = $('<div class="log-entry">' +
                            '<div class="log-entry-header">' +
                                '<a class="log-entry-name" target="_blank" href="mailto:' + this.author.email + '">' + this.author.name + '</a> ' +
                                '<span  class="log-entry-date">' + this.author.date.toLocaleString() + '</span> ' +
                                '<pre class="log-entry-hash">' + this.abbrevCommitHash() + '</pre>' +
                            '</div>' +
                            '<div class="log-entry-message"></div>' +
                        '</div>')[0];
            $(".log-entry-message", this.view)[0].appendChild(document.createTextNode(this.abbrevMessage()));
            this.view.model = this;
            var model = this;
            $(this.view).click(function (event) {
                model.select();
            });
            return this.view;
        };

        this.select = function() {
            if (currentSelection != this) {
                if (currentSelection) {
                    $(currentSelection.view).removeClass("selected");
                }
                $(this.view).addClass("selected");
                currentSelection = this;
                logView.historyView.commitView.update(this);
            }
        };
    };
};

/*
 * == DiffView ================================================================
 */
webui.DiffView = function(parent, rootElement) {

    var mainView = $('<div class="diff-view">').appendTo(rootElement)[0];

    this.update = function(diff) {
        $(mainView).empty();

        var inHeader = true;
        var diffLines = diff.split("\n");
        for (var i = 0; i < diffLines.length; ++i) {
            var line = diffLines[i];
            var pre = $('<pre class="diff-view-line">').appendTo(mainView)[0];
            pre.appendChild(document.createTextNode(line));
            var c = line[0];
            if (c == '+') {
                $(pre).addClass("diff-line-add");
            } else if (c == '-') {
                $(pre).addClass("diff-line-del");
            } else if (c == '@') {
                $(pre).addClass("diff-line-offset");
                inHeader = false;
            } else if (c == 'd') {
                inHeader = true;
            }
            if (inHeader) {
                $(pre).addClass("diff-line-header");
            }
        }
    };
};

/*
 * == CommitView ==============================================================
 */
webui.CommitView = function(parent, rootElement) {

    this.historyView = parent;
    var currentObject = null;

    this.update = function(entry) {
        if (currentObject == entry.commit) {
            // We already display the right data. No need to update.
            return;
        }
        currentObject = entry.commit;
        $(rootElement).empty();

        var diffView = new webui.DiffView(this, rootElement);
        webui.git("show " + entry.commit, function(data) {
            diffView.update(data);
        });
    };
};

/*
 * == HistoryView =============================================================
 */
webui.HistoryView = function(parent, rootElement) {

    this.mainUi = parent;
    var historyView = this;
    var mainView = $('<div id="history-view"><div id="log-view"></div><div id="commit-view"></div></div>')[0];
    this.commitView = new webui.CommitView(this, $("#commit-view", mainView)[0]);
    this.logView = new webui.LogView(this, $("#log-view", mainView)[0]);

    this.show = function() {
        $(rootElement).empty();
        rootElement.appendChild(mainView);
    };

    this.update = function(ref) {
        this.show();
        this.logView.update(ref);
    };
};

/*
 * == WorkspaceView ===========================================================
 */
webui.WorkspaceView = function(parent, rootElement) {

    this.mainUi = parent;
    var workspaceView = this;
    var mainView = $('<div id="workspace-view">' +
                        '<div id="workspace-diff-view"></div>' +
                        '<div id="workspace-editor"></div>' +
                    '</div>')[0];
    var workspaceDiffView = $("#workspace-diff-view", mainView)[0];
    this.diffView = new webui.DiffView(this, workspaceDiffView);
    var workspaceEditor = $("#workspace-editor", mainView)[0];
    this.workingCopyView = new webui.ChangedFilesView(this, workspaceEditor, "working-copy", "Working Copy");
    this.commitMessageView = new webui.CommitMessageView(this, workspaceEditor);
    this.stagingAreaView = new webui.ChangedFilesView(this, workspaceEditor, "staging-area", "Staging Area");

    this.show = function() {
        $(rootElement).empty();
        rootElement.appendChild(mainView);
    };

    this.update = function() {
        this.show();
        this.diffView.update("");
        this.workingCopyView.update();
        this.stagingAreaView.update();
        this.commitMessageView.update();
    };
};

/*
 * == ChangedFilesView ========================================================
 */
webui.ChangedFilesView = function(workspaceView, rootElement, type, label) {

    var changedFilesView = this;
    var mainView = $('<div id="' + type + '-view" class="workspace-editor-box">' +
                        '<p>'+ label + '</p>' +
                        '<div id="' + type + '-file-list" class="file-list">' +
                            '<ul id="' + type + '-file-list-content" class="file-list"></ul>' +
                        '</div>' +
                     '</div>').appendTo(rootElement)[0];
    var fileList = $("#" + type + "-file-list-content", mainView)[0];
    var currentSelection = null;

    this.filesCount = 0;

    this.update = function() {
        $(fileList).empty()
        var col = type == "working-copy" ? 1 : 0;
        webui.git("status --porcelain", function(data) {
            changedFilesView.filesCount = 0;
            webui.splitLines(data).forEach(function(line) {
                var status = line[col];
                if (col == 0 && status != " " && status != "?" || col == 1 && status != " ") {
                    ++changedFilesView.filesCount;
                    var li = $('<li>').appendTo(fileList)[0];
                    li.model = line.substr(3);
                    li.appendChild(document.createTextNode(li.model));
                    $(li).click(changedFilesView.select);
                    if (col == 0) {
                        $(li).dblclick(changedFilesView.unstage);
                    } else {
                        $(li).dblclick(changedFilesView.stage);
                    }
                }
            });
        });
    };

    this.select = function(event) {
        var clicked = event.target;
        if (currentSelection != clicked) {
            if (currentSelection) {
                $(currentSelection).removeClass("selected");
            }
            $(clicked).addClass("selected");
            currentSelection = clicked;
            if (type == "working-copy") {
                workspaceView.stagingAreaView.unselect();
                var gitCmd = "diff "
            } else {
                workspaceView.workingCopyView.unselect();
                var gitCmd = "diff --cached "
            }
            var filename = clicked.childNodes[0].textContent;
            webui.git(gitCmd + filename, function(data) {
                workspaceView.diffView.update(data);
            });
        }
    };

    this.unselect = function() {
        if (currentSelection) {
            $(currentSelection).removeClass("selected");
            currentSelection = null;
        }
    }

    this.stage = function(event) {
        webui.git("add " + event.target.model, function(data) {
            workspaceView.update();
        });
    };

    this.unstage = function(event) {
        webui.git("reset " + event.target.model, function(data) {
            workspaceView.update();
        });
    };
};

/*
 * == CommitMessageView =======================================================
 */
webui.CommitMessageView = function(workspaceView, rootElement) {

    var commitMessageView = this;

    var mainView = $('<div id="commit-message-view" class="workspace-editor-box">' +
                        '<p>Message</p>' +
                        '<textarea id="commit-message-textarea"></textarea>' +
                        '<div id="commit-controls">' +
                            '<input id="amend" type="checkbox"><label for="amend">Amend</label>' +
                            '<button type="button">Commit</button>' +
                        '</div>' +
                     '</div>').appendTo(rootElement)[0];
    var textArea = $("#commit-message-textarea", mainView)[0];
    var amend = $("input", mainView)[0];
    var commitButton = $("button", mainView)[0];

    var mainView = $().appendTo(rootElement)[0];

    $(amend).change(function() {
        if (amend.checked && textArea.value.length == 0) {
            webui.git("log --pretty=format:%s -n 1", function(data) {
                textArea.value = data;
            });
        }
    });

    $(commitButton).click(function() {
        if (workspaceView.stagingAreaView.filesCount == 0) {
            console.log("No files staged for commit");
        } else if (textArea.value.length == 0) {
            console.log("Enter a commit message first");
        } else {
            var cmd = "commit ";
            if (amend.checked) {
                cmd += "--amend ";
            }
            cmd += '-m "' + textArea.value + '"'
            webui.git(cmd, function(data) {
                textArea.value = "";
                amend.checked = false;
                workspaceView.update();
            });
        }
    });

    this.update = function() {
    };
};


/*
 *  == Initialization =========================================================
 */
function MainUi() {
    this.sideBar = new webui.SideBar(this, $("#sidebar-content")[0]);
    this.historyView = new webui.HistoryView(this, $("#main")[0]);
    this.workspaceView = new webui.WorkspaceView(this, $("#main")[0]);
}

$(document).ready(function () {
    new MainUi()
});
