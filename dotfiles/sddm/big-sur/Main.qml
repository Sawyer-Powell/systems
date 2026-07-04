import QtQuick 2.15
import QtQuick.Controls 2.15 as QQC
import QtQuick.Layouts 1.15
import SddmComponents 2.0

Rectangle {
    id: root
    width: Screen.width
    height: Screen.height
    color: "#1d2021"

    property color bg0: "#1d2021"
    property color bg1: "#282828"
    property color bg2: "#3c3836"
    property color fg0: "#fbf1c7"
    property color fg1: "#ebdbb2"
    property color muted: "#a89984"
    property color orange: "#fe8019"
    property color orangeDim: "#d65d0e"
    property color yellow: "#d79921"
    property color red: "#fb4934"

    TextConstants { id: textConstants }

    property date now: new Date()
    Timer {
        interval: 1000
        running: true
        repeat: true
        onTriggered: root.now = new Date()
    }

    Image {
        anchors.fill: parent
        source: config.background
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
        cache: true
    }

    Rectangle {
        anchors.fill: parent
        color: "#000000"
        opacity: 0.34
    }

    Item {
        id: leftPanel
        anchors.left: parent.left
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: parent.width * 0.5

        ColumnLayout {
            width: Math.min(620, parent.width * 0.78)
            anchors.left: parent.left
            anchors.leftMargin: Math.max(72, root.width * 0.075)
            anchors.verticalCenter: parent.verticalCenter
            spacing: 10

            QQC.Label {
                text: Qt.formatTime(root.now, "HH:mm")
                color: fg0
                font.pixelSize: Math.min(128, Math.max(76, root.height * 0.105))
                font.bold: true
                lineHeight: 0.88
                style: Text.Raised
                styleColor: "#00000080"
            }

            QQC.Label {
                text: Qt.formatDate(root.now, "dddd")
                color: fg1
                opacity: 0.96
                font.pixelSize: Math.min(42, Math.max(28, root.height * 0.035))
                font.weight: Font.DemiBold
            }

            QQC.Label {
                text: Qt.formatDate(root.now, "MMMM d")
                color: muted
                opacity: 0.95
                font.pixelSize: Math.min(30, Math.max(22, root.height * 0.026))
            }
        }
    }

    Item {
        id: rightPanel
        anchors.right: parent.right
        anchors.top: parent.top
        anchors.bottom: parent.bottom
        width: parent.width * 0.5

        ColumnLayout {
            id: loginStack
            width: Math.min(430, parent.width * 0.72)
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.verticalCenter: parent.verticalCenter
            anchors.horizontalCenterOffset: -Math.max(0, root.width * 0.025)
            anchors.verticalCenterOffset: Math.max(24, root.height * 0.035)
            spacing: 14

            QQC.TextField {
                id: userBox
                Layout.fillWidth: true
                Layout.preferredHeight: 52
                text: userModel.lastUser || "sawyer"
                placeholderText: textConstants.username
                font.pixelSize: 15
                color: fg0
                placeholderTextColor: muted
                selectByMouse: true
                leftPadding: 18
                rightPadding: 18
                topPadding: 11
                bottomPadding: 11
                background: Rectangle {
                    radius: 16
                    color: bg0
                    opacity: 0.96
                    border.color: userBox.activeFocus ? yellow : bg2
                    border.width: userBox.activeFocus ? 2 : 1
                }
            }

            QQC.TextField {
                id: passwordBox
                Layout.fillWidth: true
                Layout.preferredHeight: 52
                placeholderText: textConstants.password
                echoMode: TextInput.Password
                focus: true
                font.pixelSize: 16
                color: fg0
                placeholderTextColor: muted
                leftPadding: 18
                rightPadding: 18
                topPadding: 11
                bottomPadding: 11
                background: Rectangle {
                    radius: 16
                    color: bg0
                    opacity: 0.96
                    border.color: passwordBox.activeFocus ? yellow : bg2
                    border.width: passwordBox.activeFocus ? 2 : 1
                }
                Keys.onReturnPressed: loginButton.clicked()
                Keys.onEnterPressed: loginButton.clicked()
            }

            QQC.Button {
                id: loginButton
                Layout.fillWidth: true
                Layout.preferredHeight: 52
                hoverEnabled: true
                text: textConstants.login
                font.pixelSize: 16
                font.bold: true
                onClicked: sddm.login(userBox.text, passwordBox.text, sessionModel.lastIndex >= 0 ? sessionModel.lastIndex : 0)

                contentItem: Text {
                    text: loginButton.text
                    color: bg0
                    font: loginButton.font
                    horizontalAlignment: Text.AlignHCenter
                    verticalAlignment: Text.AlignVCenter
                }

                background: Rectangle {
                    radius: 16
                    color: loginButton.down ? orangeDim : (loginButton.hovered ? "#fabd2f" : orange)
                    border.color: "#fabd2f"
                    border.width: loginButton.activeFocus ? 2 : 0
                }
            }

            QQC.Label {
                Layout.fillWidth: true
                text: textConstants.loginFailed
                visible: false
                color: red
                horizontalAlignment: Text.AlignHCenter
                font.pixelSize: 13

                Connections {
                    target: sddm
                    function onLoginFailed() { parent.visible = true; passwordBox.text = ""; passwordBox.forceActiveFocus(); }
                    function onLoginSucceeded() { parent.visible = false; }
                }
            }

            Item { Layout.preferredHeight: 0 }

            RowLayout {
                Layout.alignment: Qt.AlignRight
                spacing: 12

                QQC.Button {
                    Layout.preferredWidth: 44
                    Layout.preferredHeight: 44
                    hoverEnabled: true
                    onClicked: sddm.suspend()
                    contentItem: Item {
                        Image {
                            anchors.centerIn: parent
                            source: "Assets/moon.svg"
                            width: 24
                            height: 24
                            sourceSize.width: 48
                            sourceSize.height: 48
                            fillMode: Image.PreserveAspectFit
                            smooth: true
                            mipmap: true
                        }
                    }
                    background: Rectangle { radius: 22; color: parent.hovered ? bg1 : bg0; opacity: 0.92; border.color: bg2; border.width: 1 }
                }

                QQC.Button {
                    Layout.preferredWidth: 44
                    Layout.preferredHeight: 44
                    hoverEnabled: true
                    onClicked: sddm.reboot()
                    contentItem: Item {
                        Image {
                            anchors.centerIn: parent
                            source: "Assets/rotate-ccw.svg"
                            width: 24
                            height: 24
                            sourceSize.width: 48
                            sourceSize.height: 48
                            fillMode: Image.PreserveAspectFit
                            smooth: true
                            mipmap: true
                        }
                    }
                    background: Rectangle { radius: 22; color: parent.hovered ? bg1 : bg0; opacity: 0.92; border.color: bg2; border.width: 1 }
                }

                QQC.Button {
                    Layout.preferredWidth: 44
                    Layout.preferredHeight: 44
                    hoverEnabled: true
                    onClicked: sddm.powerOff()
                    contentItem: Item {
                        Image {
                            anchors.centerIn: parent
                            source: "Assets/power.svg"
                            width: 24
                            height: 24
                            sourceSize.width: 48
                            sourceSize.height: 48
                            fillMode: Image.PreserveAspectFit
                            smooth: true
                            mipmap: true
                        }
                    }
                    background: Rectangle { radius: 22; color: parent.hovered ? bg1 : bg0; opacity: 0.92; border.color: bg2; border.width: 1 }
                }
            }
        }
    }
}
