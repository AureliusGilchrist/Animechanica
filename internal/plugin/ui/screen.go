package plugin_ui

import (
	"net/url"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

type ScreenManager struct {
	ctx *Context
	mu  sync.RWMutex
}

func NewScreenManager(ctx *Context) *ScreenManager {
	return &ScreenManager{
		ctx: ctx,
	}
}

// bind binds 'screen' to the ctx object
//
//	Example:
//	ctx.screen.navigateTo("/entry?id=21");
func (s *ScreenManager) bind(ctxObj *goja.Object) {
	screenObj := s.ctx.vm.NewObject()
	_ = screenObj.Set("onNavigate", s.jsOnNavigate)
	_ = screenObj.Set("navigateTo", s.jsNavigateTo)
	_ = screenObj.Set("reload", s.jsReload)
	_ = screenObj.Set("loadCurrent", s.jsLoadCurrent)
	_ = screenObj.Set("onPlaybackStarted", s.jsOnPlaybackStarted)
	_ = screenObj.Set("onPlaybackStopped", s.jsOnPlaybackStopped)

	_ = ctxObj.Set("screen", screenObj)
}

// jsNavigateTo navigates to a new screen
//
//	Example:
//	ctx.screen.navigateTo("/entry?id=21");
func (s *ScreenManager) jsNavigateTo(path string, searchParams map[string]string) {
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}

	queryString := ""
	if len(searchParams) > 0 {
		query := url.Values{}
		for key, value := range searchParams {
			query.Add(key, value)
		}
		queryString = "?" + query.Encode()
	}

	finalPath := path + queryString

	s.ctx.SendEventToClient(ServerScreenNavigateToEvent, ServerScreenNavigateToEventPayload{
		Path: finalPath,
	})
}

// jsReload reloads the current screen
func (s *ScreenManager) jsReload() {
	s.ctx.SendEventToClient(ServerScreenReloadEvent, ServerScreenReloadEventPayload{})
}

// jsLoadCurrent calls onNavigate with the current screen data
func (s *ScreenManager) jsLoadCurrent() {
	s.ctx.SendEventToClient(ServerScreenGetCurrentEvent, ServerScreenGetCurrentEventPayload{})
}

// jsOnNavigate registers a callback to be called when the current screen changes
//
//	Example:
//	const onNavigate = (event) => {
//		console.log(event.screen);
//	};
//	ctx.screen.onNavigate(onNavigate);
func (s *ScreenManager) jsOnNavigate(callback goja.Callable) goja.Value {
	eventListener := s.ctx.RegisterEventListener(ClientScreenChangedEvent)

	eventListener.SetCallback(func(event *ClientPluginEvent) {
		var payload ClientScreenChangedEventPayload
		if event.ParsePayloadAs(ClientScreenChangedEvent, &payload) {
			s.ctx.scheduler.ScheduleAsync(func() error {

				parsedQuery, _ := url.ParseQuery(strings.TrimPrefix(payload.Query, "?"))
				queryMap := make(map[string]string)
				for key, value := range parsedQuery {
					queryMap[key] = strings.Join(value, ",")
				}

				ret := map[string]interface{}{
					"pathname":     payload.Pathname,
					"searchParams": queryMap,
				}

				_, err := callback(goja.Undefined(), s.ctx.vm.ToValue(ret))
				return err
			})
		}
	})

	return goja.Undefined()
}

// jsOnPlaybackStarted registers a callback to be called when video/stream playback starts
// This is useful for plugins that need to stop playing audio when the user starts watching
//
//	Example:
//	ctx.screen.onPlaybackStarted((event) => {
//		console.log("Playback started", event.mediaId, event.type);
//		// Stop playing theme song
//	});
func (s *ScreenManager) jsOnPlaybackStarted(callback goja.Callable) goja.Value {
	eventListener := s.ctx.RegisterEventListener(ClientPlaybackStartedEvent)

	eventListener.SetCallback(func(event *ClientPluginEvent) {
		var payload ClientPlaybackStartedEventPayload
		if event.ParsePayloadAs(ClientPlaybackStartedEvent, &payload) {
			s.ctx.scheduler.ScheduleAsync(func() error {
				ret := map[string]interface{}{
					"mediaId": payload.MediaID,
					"type":    payload.Type,
				}
				_, err := callback(goja.Undefined(), s.ctx.vm.ToValue(ret))
				return err
			})
		}
	})

	return goja.Undefined()
}

// jsOnPlaybackStopped registers a callback to be called when video/stream playback stops
//
//	Example:
//	ctx.screen.onPlaybackStopped((event) => {
//		console.log("Playback stopped", event.mediaId, event.type);
//	});
func (s *ScreenManager) jsOnPlaybackStopped(callback goja.Callable) goja.Value {
	eventListener := s.ctx.RegisterEventListener(ClientPlaybackStoppedEvent)

	eventListener.SetCallback(func(event *ClientPluginEvent) {
		var payload ClientPlaybackStoppedEventPayload
		if event.ParsePayloadAs(ClientPlaybackStoppedEvent, &payload) {
			s.ctx.scheduler.ScheduleAsync(func() error {
				ret := map[string]interface{}{
					"mediaId": payload.MediaID,
					"type":    payload.Type,
				}
				_, err := callback(goja.Undefined(), s.ctx.vm.ToValue(ret))
				return err
			})
		}
	})

	return goja.Undefined()
}
