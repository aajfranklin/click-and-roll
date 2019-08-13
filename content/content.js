let statTemplate;
let currentPlayerId;
let dataReceived;
let frameStyle;
let namePosition = {};
let currentNameElement;
let lastBodyText;
let frameContainer;
let statDisplay;
let clickAndRollFrame;
let players;

const checkPlayerCache = () => {
  chrome.storage.local.get(['players'], (response) => {
    players = response.players;

    if (players === undefined) {
      backgroundScriptRequest({message: 'fetchPlayers'})
        .then(players => {
          saveToChromeStorage('players', players);
          run();
        })
        .catch(err => {
          console.log(err);
        })
    } else {
      run();
    }
  });
};

const backgroundScriptRequest = (request) => {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, (response => {
      const [err, res] = response;
      if (err != null) {
        reject(err);
      } else {
        resolve(res);
      }
    }));
  });
};

const saveToChromeStorage = (name, values) => {
  chrome.storage.local.set({[name]: values}, () => {
    console.log(name + ' saved');
  });
};

const run = () => {

  frameContainer = document.createElement('div');
  clickAndRollFrame = document.createElement('iframe');
  statDisplay = document.createElement('div');
  frameContainer.id = 'click-and-roll-frame-container';
  clickAndRollFrame.id ='click-and-roll-frame';
  statDisplay.id = 'stat-display';

  $.ajax(chrome.extension.getURL('view/frame.html'), {method: 'GET'})
    .then(response => {
      statTemplate = response;
      return $.ajax(chrome.extension.getURL('view/frame.css'), {method: 'GET'})
    })
    .then(response => {
      frameStyle = response;
      lastBodyText = document.body.textContent;
      const playerNames = players.map((player) => player.name);
      const initialResults = searchTextContent(document.body, playerNames);

      if (initialResults.length > 0) {
        locateAndFormatResults(document.body, initialResults);
      }

      observeMutations(playerNames);
    });
};

/*
Functions relating to finding and formatting results.
 */

const searchTextContent = (rootNode, playerNames) => {
  const nodeText = rootNode.textContent;
  const ac = new AhoCorasick(playerNames);
  return ac.search(nodeText);
};

const locateAndFormatResults = (rootNode, results) => {
  const treeWalker = document.createTreeWalker(rootNode, 4);
  let currentTextIndex = 0;
  let nextResult = getNextResult(results);
  let currentNode = rootNode;

  while (nextResult !== null && currentNode !== null) {
    // traverse node tree and locate text node containing next result
    currentNode = treeWalker.currentNode.nodeName === '#text'
      ? treeWalker.currentNode
      : treeWalker.nextNode();
    const nodeTextLength = currentNode.textContent.length;
    const nodeIncludesNextResult = currentTextIndex + nodeTextLength >= nextResult.index;

    if (nodeIncludesNextResult) {
      if (parentNodeIsValid(currentNode)) {
        highlightResult(nextResult, currentNode, currentTextIndex);
      }
      nextResult = getNextResult(results);
    } else {
      currentTextIndex += nodeTextLength;
      currentNode = treeWalker.nextNode();
    }
  }
};

const getNextResult = (results) => {
  const rawResult = results.shift();
  if (rawResult !== undefined) {
    return {
      index: rawResult[0],
      name: rawResult[1][0]
    }
  }
  return null;
};

const parentNodeIsValid = (currentNode) => {
  if (currentNode.parentNode) {
    const parentNodeName = currentNode.parentNode.nodeName;
    return parentNodeName !== 'SCRIPT' && parentNodeName !== 'STYLE';
  }
  return true;
};

const highlightResult = (result, node, currentTextIndex) => {
  const resultEndOffset = result.index - currentTextIndex + 1;
  const resultStartOffset = resultEndOffset - result.name.length;

  if (resultStartOffset < 0) {
    // match is probably split into two nodes with text formatting on surname i.e. LeBron <b>James</b>
    return;
  }

  const range = document.createRange();
  range.setStart(node, resultStartOffset);
  range.setEnd(node, resultEndOffset);

  const wrapper = document.createElement('span');
  wrapper.setAttribute(
    'style',
    'color: teal; display: inline;'
  );
  range.surroundContents(wrapper);

  wrapper.onmouseenter = handleHover;
};

const observeMutations = (playerNames) => {
  const observer = new MutationObserver(function (mutations) {

    if (document.body.textContent !== lastBodyText) {
      lastBodyText = document.body.textContent;

      for (let i = 0; i < mutations.length; i++) {
        if (mutations[i].addedNodes) {
          mutations[i].addedNodes.forEach(node => {
            if (node.innerText && node.innerText.trim().length >= 4) {
              const results = searchTextContent(node, playerNames);
              if (results.length > 0) {
                observer.disconnect();
                locateAndFormatResults(node, results);
                observer.observe(document.body, { childList: true, subtree: true });
              }
            }
          });
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
};

/*
Functions handling display of stat overlay.
 */

const handleHover = (mouseEnterEvent) => {
  // prevent repeat hovers on current target, restore hover event to previous target
  if (currentNameElement) {
    currentNameElement.onmouseenter = handleHover
  }
  const targetElement = mouseEnterEvent.target;
  targetElement.onmouseenter = null;
  currentNameElement = targetElement;

  const name = targetElement.textContent;
  const newPlayerId = players.filter(player => player.name === name)[0].id;

  const oldContainerParent = frameContainer.parentNode;
  const newContainerParent = getContainerParentFromElement(targetElement);

  if (newContainerParent !== oldContainerParent) {
    updateContainerParent(oldContainerParent, newContainerParent);
  }

  frameContainer.style.height = 'calc(50vh + 2px)';
  getFrameDocument().body.innerHTML = '';
  positionFrameContainer(targetElement, newContainerParent);
  getFrameDocument().body.appendChild(statDisplay);

  if (newPlayerId !== currentPlayerId) {
    statDisplay.classList.remove('loaded');
    statDisplay.classList.add('loading');
    statDisplay.innerHTML = statTemplate;
    addCloseOverlayListeners();
    currentPlayerId = newPlayerId;
    dataReceived = false;

    backgroundScriptRequest({message: 'fetchStats', playerId: currentPlayerId})
      .then(stats => {
        // current player id may have been reassigned by a later hover, making these stats out of date
        if (newPlayerId === currentPlayerId) {
          dataReceived = true;
          displayStats(stats, name)
        }
      });
  } else {
    addCloseOverlayListeners();
    displayStats();
  }
};

const getContainerParentFromElement = (element) => {
  let rootOffsetParent = element;
  let rootScrollParent = null;

  while (rootOffsetParent.offsetParent) {
    rootOffsetParent = rootOffsetParent.offsetParent;
    rootScrollParent = (rootOffsetParent.scrollHeight > rootOffsetParent.clientHeight)
      ? rootOffsetParent
      : rootScrollParent;
  }

  return (rootOffsetParent === document.body)
    ? document.body
    : rootScrollParent || rootOffsetParent;
};

const updateContainerParent = (oldParent, newParent) => {
  if (oldParent) {
    frameContainer.parentNode.removeChild(frameContainer);
  }

  newParent.appendChild(frameContainer);
  frameContainer.appendChild(clickAndRollFrame);

  getFrameDocument().body.id = 'frame-body';

  const style = document.createElement('style');
  style.type = 'text/css';
  style.textContent = frameStyle;
  style.title = 'click-and-roll';
  getFrameDocument().head.appendChild(style);
};

const positionFrameContainer = (targetElement, containerParent) => {
  const rect = targetElement.getBoundingClientRect();
  namePosition.isLeft = rect.left < getHalfViewWidth();
  namePosition.isTop = rect.top < getHalfViewHeight();

  frameContainer.style.marginLeft = namePosition.isLeft ? '0' : '4px';

  // remove existing animation class
  statDisplay.classList.remove('reveal-from-top', 'reveal-from-bottom');

  if (namePosition.isTop) {
    statDisplay.classList.add('reveal-from-top');
  } else {
    statDisplay.classList.add('reveal-from-bottom');
  }

  const offset = getOffsetFromParent(rect, containerParent);
  frameContainer.style.top = offset.top + 'px';
  frameContainer.style.left = offset.left + 'px';
  frameContainer.hidden = false;
};

const getOffsetFromParent = (rect, containerParent) => {
  const scrollX = (containerParent === document.body)
    ? (window.scrollX ? window.scrollX : window.pageXOffset)
    : containerParent.scrollLeft;
  const scrollY = (containerParent === document.body)
    ? (window.scrollY ? window.scrollY : window.pageYOffset)
    : containerParent.scrollTop;

  const parentOffset = {
    x: (containerParent === document.body) ? 0 : containerParent.getBoundingClientRect().left,
    y: (containerParent === document.body) ? 0 : containerParent.getBoundingClientRect().top
  };

  // 2 pixel left offset to accommodate box shadow of frame's inner elements
  const overlayLeft = namePosition.isLeft
    ? rect.left + scrollX - parentOffset.x - 2
    : rect.left + scrollX - parentOffset.x - 2 - getHalfViewWidth() + rect.width + Math.max(getHalfViewWidth() - 800, 0);

  const overlayTop = namePosition.isTop
    ? rect.top + scrollY - parentOffset.y + rect.height
    : rect.top + scrollY - parentOffset.y - getHalfViewHeight();

  return {
    left: overlayLeft,
    top: overlayTop
  }
};

const addCloseOverlayListeners = () => {
  getFrameDocument().getElementById('dismiss').onclick = closeOverlay;
  document.addEventListener('click', closeOverlay);
};

const closeOverlay = () => {
  currentNameElement.onmouseenter = handleHover;
  frameContainer.hidden = true;
  document.removeEventListener('click', closeOverlay);
};

const displayStats = (stats, name) => {
  // catches edge case where user hovers on same name in quick succession, ensures loading graphic displays until data arrives
  if (!dataReceived) return;

  statDisplay.classList.remove('loading');
  statDisplay.classList.add('loaded');

  if (stats) {
    getFrameDocument().getElementById('player-name').textContent = name;
    mapPlayerProfile(stats.profile, name);
    mapStatsToRows(stats.career);
  }

  if (!frameContainer.hidden) {
    resizeStatDisplay();
  }
};

const mapPlayerProfile = (profile, name) => {
  const profileImageElement = getFrameDocument().getElementById('player-profile-image');

  fetch(profile.imageUrl, {cache: 'force-cache', redirect: 'error'})
    .then(() => {
      profileImageElement.src = profile.imageUrl;
      profileImageElement.alt = name;
    })
    .catch(err => {
      console.log(err);
    });

  const profileInfoDetails = [
    'team',
    'number',
    'position',
    'birthday',
    'height',
    'weight',
    'country',
    'college',
    'draft'
  ];

  for (let i = 0; i < profileInfoDetails.length; i++) {
    const infoDataElement = getFrameDocument().getElementById('info-' + profileInfoDetails[i]);
    infoDataElement.textContent = profile[profileInfoDetails[i]];
  }
};

const mapStatsToRows = (stats) => {
  if (stats.seasons.rowSet.length === 0) {
    getFrameDocument().getElementById('content').removeChild(getFrameDocument().getElementById('career-heading'));
    getFrameDocument().getElementById('content').removeChild(getFrameDocument().getElementById('table-container'));
  }

  for (let i = 0; i < stats.seasons.rowSet.length; i++) {
    const season = stats.seasons.rowSet[i];
    const row = createRow(season, stats.allStarSeasons.indexOf(season[1]) !== -1, false);
    getFrameDocument().getElementById('season-averages-body').appendChild(row);
  }

  if (stats.career.rowSet.length !== 0) {
    const careerRow = createRow(stats.career.rowSet[0], false, true);
    careerRow.classList.add('career');
    getFrameDocument().getElementById('season-averages-body').appendChild(careerRow);
  }
};

const createRow = (season, isAllStarSeason, isCareerRow) => {
  if (isCareerRow) {
    season[0] = 'Career';
    season[1] = season[2] = '-';
  } else {
    const statsToRemove = [3, 2, 0];
    for (let j = 0; j < statsToRemove.length; j++) {
      season.splice(statsToRemove[j], 1);
    }
  }

  const row = getFrameDocument().createElement('tr');

  for (let k = 0; k < season.length; k++) {
    const stat = getFrameDocument().createElement('td');
    stat.textContent = (season[k] === null)
      ? 'n/a'
      : season[k];
    if (k === 0) {
      stat.classList.add('season');
      stat.classList.add('stick-left');
      stat.innerHTML += isAllStarSeason
        ? '<span style="color:gold; padding-left: 8px">&#9733;</span>'
        : '';
    }
    row.appendChild(stat)
  }

  return row;
};

const resizeStatDisplay = () => {
  const frameContent = getFrameDocument().getElementById('content');
  const playerHeaderHeight = 37;

  if (frameContent.scrollHeight + playerHeaderHeight < (getHalfViewHeight()) - 2) {
    statDisplay.classList.remove('reveal-from-top', 'reveal-from-bottom');
    const newHeight = (frameContent.scrollHeight + playerHeaderHeight) + 'px';

    const rule = namePosition.isTop
      ? '@keyframes resize{from{height:calc(100vh - 2px);}'
      + 'to{height:' + newHeight + ';}}'
      : '@keyframes resize{from{height:calc(100vh - 2px);margin-top:0;;}'
      + 'to{height:' + newHeight + ';margin-top:calc(100vh - 2px - ' + newHeight + ');}}';

    // if user has scrolled over multiple names in quick succession, existing resize rule and event listeners should be removed
    removeResizeAnimation();
    statDisplay.removeEventListener('animationend', handleAnimationEnd);

    getStyleSheet().insertRule(rule, 0);
    statDisplay.addEventListener('animationend', handleAnimationEnd);
    statDisplay.classList.add('resize');
  }
};

const handleAnimationEnd = (animationEvent) => {
  if (animationEvent.animationName === 'resize') {
    removeResizeAnimation();
    statDisplay.classList.remove('resize');
    statDisplay.removeEventListener('animationend', handleAnimationEnd);

    const statDisplayHeight = statDisplay.scrollHeight + 2;
    frameContainer.style.height = statDisplayHeight + 'px';
    frameContainer.style.top = namePosition.isTop
      ? frameContainer.style.top
      : frameContainer.offsetTop + getHalfViewHeight() - statDisplayHeight + 'px';
  }
};

const removeResizeAnimation = () => {
  const stylesheet = getStyleSheet();
  const resizeRules = Array.prototype.filter.call(stylesheet.rules, rule => rule.name === 'resize');
  for (let i = 0; i < resizeRules.length; i++) {
    stylesheet.deleteRule(Array.prototype.indexOf.call(stylesheet.rules, resizeRules[i]));
  }
};

const getHalfViewHeight = () => {
  return window.innerHeight / 2;
};

const getHalfViewWidth = () => {
  return window.innerWidth / 2;
};

// ensures we always manipulate the correct style sheet if others are injected in iFrame e.g. by another extension
const getStyleSheet = () => {
  return Array.prototype.filter.call(getFrameDocument().styleSheets, stylesheet => {
    return stylesheet.title === 'click-and-roll';
  })[0];
};

const getFrameDocument = () => {
  return clickAndRollFrame.contentDocument;
};

window.addEventListener('load', checkPlayerCache);
