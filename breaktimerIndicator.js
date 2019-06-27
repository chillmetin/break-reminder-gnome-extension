const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const MessageTray = imports.ui.messageTray;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Slider = imports.ui.slider
const St = imports.gi.St;
const Util = Me.imports.util;

var debug = false;
var ts = new Date().valueOf()

const Indicator = new Lang.Class({
    Name: 'ReminderIndicator',
    Extends: PanelMenu.Button,
    _init: function () {
        this.parent(St.Align.START);
        this.settings = Util.getSettings();
        
        this.meter = new St.DrawingArea({reactive: false, width: 18, height: 18});
        this.meter.connect('repaint', Lang.bind(this, this.drawMeter));
        this.settings.connect('changed::enabled', 
            Lang.bind(this, function () { this.meter.queue_repaint(); }));
        this.actor.add_actor(this.meter);
        this.connect('destroy', Lang.bind(this, this.onDestroy));
        
        this.startTimer();
        

        this.buildMenu();
    },
    destroyed: false,
    onDestroy: function () {
        this.source && this.source.destroy();
    },
    drawMeter: function (){
        let [width, height] = this.meter.get_surface_size();
        let enabled = this.settings.get_boolean('enabled');
        
        let cr = this.meter.get_context();
        let [res, c] = Clutter.Color.from_string('#ccc');
        let xc = width / 2;
        let yc = height / 2;
        let scale = Math.min(xc, yc) / 2;
        let r = scale * 1.5;

        let pct = (this.elapsed / 60) / this.settings.get_int('minutes');
        if (!enabled)
            [res, c] = Clutter.Color.from_string('#666');
        else if (pct >= 1)
            [res, c] = Clutter.Color.from_string('#c22');
        else if (pct >= .8)
            [res, c] = Clutter.Color.from_string('#855');
        else if (pct >= .9)
            [res, c] = Clutter.Color.from_string('#a33');
        Clutter.cairo_set_source_color(cr, c);

        cr.translate(xc, yc);
        cr.scale(.6, .6);

        cr.arc(0, -r * 1.6, r * .5, 0, 2 * Math.PI);
        cr.fill();

        cr.scale(1.5, 1.5);
        cr.translate(-r, -r);
        cr.moveTo(5.214844, 7.441406);
        cr.curveTo(5.214844, 7.441406, 6.328125, 8.558594, 7.441406, 7.441406);
        cr.curveTo(8.558594, 6.328125, 7.441406, 5.214844, 7.441406, 5.214844);
        cr.curveTo(7.441406, 5.214844, 1.3125, -0.917969, 0.199219, 0.199219);
        cr.curveTo(-0.917969, 1.3125, 5.214844, 7.441406, 5.214844, 7.441406);
        cr.closePath();
        cr.fill();

        let start = -1, end = Math.PI * 1.1;
        cr.translate(r, r);
        cr.arc(0, 0, r * 1.1, start, end);
        cr.stroke();
        
        if (pct < 1 && enabled)
            [res, c] = Clutter.Color.from_string('#080');
        pct = Math.min(end, pct * (end - start) + start);
        Clutter.cairo_set_source_color(cr, c);
        cr.arc(0, 0, r * 1.1, Math.max(pct - .5, start), pct);
        cr.stroke();
    },
    buildMenu: function () {
        let toggle = new PopupMenu.PopupSwitchMenuItem("", this.settings.get_boolean('enabled'));
        let message = 'Remind every %s minutes';
        let minutes = this.settings.get_int('minutes');
        
        toggle.label.set_text(message.format(minutes));
        toggle.connect('toggled', Lang.bind(this, function(){
            this.settings.set_boolean('enabled', toggle.state);
            if(toggle.state)
                this.startTimer();
        }));
        this.menu.addMenuItem(toggle);
        
        let slider = new SliderItem(minutes / 59);
        slider.connect('value-changed', Lang.bind(this, function (target, value){
            let val = Math.ceil(value * 59) + 1;
            toggle.label.set_text(message.format(val));
            this.settings.set_int('minutes', val);
        }));
        this.menu.addMenuItem(slider);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        let w = new PopupMenu.PopupMenuItem(_("Restart Timer"));
        w.connect('activate', Lang.bind(this, function(){ this.startTimer() }));
        this.menu.addMenuItem(w);
    },
    refreshTimer: function (timerId, initialMinutes){
      global.log('IDs:', timerId, this.timerId);
      if(this.timerId != timerId || !this.settings.get_boolean('enabled') || this.destroyed)
        return false;
      if(this.settings.get_int('minutes') < initialMinutes){
        // Pref must have been changed.  Just start over.
        this.startTimer();
        return false;
      }
      try{
        let minutes =  this.settings.get_int('minutes');
        let idleSeconds = 0;
        try {
          idleSeconds = GLib.spawn_command_line_sync("xprintidle")[1] / 1000;
        } catch (e) {
          global.log("Error getting idle amount.  Is xprintidle installed?");
        }
        let adj = ((idleSeconds / 30) > .8) ? -Math.max(idleSeconds, 30) : 30;
        this.elapsed = Math.max(0, this.elapsed + adj);
        if (debug)
            global.log(ts + ' ' + timerId + ' I:' + idleSeconds + ', A:' + adj + ', E:' + this.elapsed);
        Mainloop.timeout_add_seconds(30, 
            Lang.bind(this, this.refreshTimer, timerId, initialMinutes));
        this.meter.queue_repaint();
        if ((this.elapsed / 60) >= minutes) {
            this.timerFinished();
        } else if (this.source) {
            this.source.destroy();
            this.source = null;
        }
      }catch(e){
          global.log("error: " + e.toString());
      } finally {
          return false;
      }
    },
    timerFinished: function () {
        let message = this.settings.get_string('message');
        if (message && !this.destroyed) {
            if (!this.source)
                this.source = new MessageTray.Source("Break Timer", 'avatar-default');
            if (!Main.messageTray.contains(this.source))
                Main.messageTray.add(this.source);
            if (!this.notification) {
                if (debug)
                    global.log('timer finished');
                this.notification = new MessageTray.Notification(this.source, "Break Reminder", message, {
                    gicon: Gio.icon_new_for_string(Me.path + "/icon.png")
                });
                this.notification.setTransient(true);
            }
            let notification = new MessageTray.Notification(this.source, "Break Reminder", message, {
                gicon: Gio.icon_new_for_string(Me.path + "/icon.png")
            });
            notification.setTransient(true);
            this.source.notify(notification);
        }
    },
    startTimer: function () {
      this.timerId = Math.floor(Math.random() * 10000);
      this.elapsed = 0;
      this.refreshTimer(this.timerId, this.settings.get_int('minutes'));
    },
    destroy : function () {
        this.destroyed = true;
        this.actor.destroy();
    }
});

const SliderItem = new Lang.Class({
    Name: 'SliderItem',
    Extends: PopupMenu.PopupBaseMenuItem,

    _init: function(value) {
        this.parent();
        var layout = new Clutter.TableLayout();
        this._box = new St.Widget({
							style_class: 'slider-item',
							layout_manager: layout});

        this._slider = new Slider.Slider(value);

        layout.pack(this._slider.actor, 2, 0);
        this.actor.add(this._box, {span: -1, expand: true});
    },

    setValue: function(value) {
        this._slider.setValue(value);
    },

    getValue: function() {
        return this._slider._getCurrentValue();
    },

    setIcon: function(icon) {
        this._icon.icon_name = icon + '-symbolic';
    },

    connect: function(signal, callback) {
        this._slider.connect(signal, callback);
    }
});

